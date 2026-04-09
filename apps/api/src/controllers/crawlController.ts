import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { resolveSeedUrlList } from '@senko/crawler';
import { senkoConfig } from '@senko/shared';
import { prisma } from '@senko/db';
import { getCrawlQueue } from '../queue.js';

const startBody = z.object({
  /** Omit to use `SENKO_SEED_URLS` from the environment (still required together or via this array). */
  seedUrls: z.array(z.string().url()).optional(),
  maxDepth: z.coerce.number().max(5).optional(),
  maxPages: z.coerce.number().max(2000).optional(),
});

export async function startCrawlHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const crawlQueue = getCrawlQueue();
    if (!crawlQueue) {
      res.status(503).json({
        error:
          'Crawl queue unavailable: set REDIS_URL to a Redis protocol URL (e.g. rediss:// from Upstash Redis). QStash HTTP endpoints cannot be used as REDIS_URL for Bull.',
      });
      return;
    }
    const body = startBody.parse(req.body ?? {});
    const fromEnv = resolveSeedUrlList().slice(0, senkoConfig.crawler.cliMaxSeeds);
    const seedUrls = body.seedUrls?.length ? body.seedUrls : fromEnv;
    if (seedUrls.length === 0) {
      res.status(400).json({
        error:
          'No crawl seeds: pass non-empty `seedUrls` in the JSON body or set `SENKO_SEED_URLS` in the environment. The indexer does not ship a hardcoded site list.',
      });
      return;
    }
    const maxDepth = body.maxDepth ?? senkoConfig.crawler.cliMaxDepth;
    const maxPages = body.maxPages ?? senkoConfig.crawler.cliMaxPages;
    const job = await prisma.crawlJob.create({
      data: {
        seedUrls,
        status: 'queued',
      },
    });
    await crawlQueue.add(
      {
        jobId: job.id,
        seedUrls,
        maxDepth,
        maxPages,
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );
    res.json({ jobId: job.id, status: 'queued' as const });
  } catch (e) {
    next(e);
  }
}

export async function crawlStatusHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const jobId = z.string().min(1).parse(req.params.jobId);
    const job = await prisma.crawlJob.findUnique({ where: { id: jobId } });
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json({
      id: job.id,
      status: job.status,
      pagesFound: job.pagesFound,
      errors: job.errors,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      seedUrls: job.seedUrls,
    });
  } catch (e) {
    next(e);
  }
}
