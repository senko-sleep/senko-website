import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '@senko/db';
import { getCrawlQueue } from '../queue.js';

const startBody = z.object({
  seedUrls: z.array(z.string().url()),
  maxDepth: z.number().max(5).optional().default(2),
  maxPages: z.number().max(2000).optional().default(200),
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
    const body = startBody.parse(req.body);
    const job = await prisma.crawlJob.create({
      data: {
        seedUrls: body.seedUrls,
        status: 'queued',
      },
    });
    await crawlQueue.add(
      {
        jobId: job.id,
        seedUrls: body.seedUrls,
        maxDepth: body.maxDepth,
        maxPages: body.maxPages,
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
