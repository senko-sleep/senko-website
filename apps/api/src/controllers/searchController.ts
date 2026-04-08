import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { QueryParser, WebRanker, ImageRanker, VideoRanker, GifRanker } from '@senko/indexer';
import type { SearchResponse } from '@senko/shared';
import { prisma } from '@senko/db';
import { cache } from '../redis.js';

const searchParams = z.object({
  q: z.string().min(1),
  type: z.enum(['web', 'image', 'video', 'gif', 'all', 'news']).optional(),
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(50).default(10),
  safe: z.coerce.number().optional(),
});

const suggestParams = z.object({
  q: z.string().min(1),
});

const parser = new QueryParser();
const webRanker = new WebRanker(cache);
const imageRanker = new ImageRanker();
const videoRanker = new VideoRanker();
const gifRanker = new GifRanker();

function safeFlag(req: Request): boolean {
  const s = req.query.safe;
  if (s === '0' || s === 'false') return false;
  return true;
}

export async function searchHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const t0 = Date.now();
    const parsed = searchParams.parse(req.query);
    const searchType = parsed.type ?? 'web';
    const pq = parser.parse(
      parsed.q,
      searchType === 'news' ? 'news' : searchType === 'all' ? 'all' : searchType,
    );
    const safe = parsed.safe === 0 ? false : safeFlag(req);

    let body: SearchResponse;

    if (searchType === 'all') {
      const [w, i, v, g] = await Promise.all([
        webRanker.search({ ...pq, type: 'web' }, parsed.page, parsed.perPage, { safe }),
        imageRanker.search({ ...pq, type: 'image' }, parsed.page, parsed.perPage, { safe }),
        videoRanker.search({ ...pq, type: 'video' }, parsed.page, parsed.perPage, { safe }),
        gifRanker.search({ ...pq, type: 'gif' }, parsed.page, parsed.perPage, { safe }),
      ]);
      const merged = [...w.results, ...i.results, ...v.results, ...g.results].sort((a, b) => b.score - a.score);
      const slice = merged.slice(0, parsed.perPage);
      body = {
        query: parsed.q,
        type: 'all',
        page: parsed.page,
        perPage: parsed.perPage,
        totalResults: merged.length,
        results: slice,
      };
    } else if (searchType === 'news') {
      body = await webRanker.search({ ...pq, type: 'web' }, parsed.page, parsed.perPage, {
        safe,
        newsOnly: true,
      });
    } else if (searchType === 'web') {
      body = await webRanker.search({ ...pq, type: 'web' }, parsed.page, parsed.perPage, { safe });
    } else if (searchType === 'image') {
      body = await imageRanker.search({ ...pq, type: 'image' }, parsed.page, parsed.perPage, { safe });
    } else if (searchType === 'video') {
      body = await videoRanker.search({ ...pq, type: 'video' }, parsed.page, parsed.perPage, { safe });
    } else {
      body = await gifRanker.search({ ...pq, type: 'gif' }, parsed.page, parsed.perPage, { safe });
    }

    await cache.zincrby('senko:trending', 1, parsed.q.toLowerCase());

    res.setHeader('X-Search-Time', String(Date.now() - t0));
    res.json(body);
  } catch (e) {
    next(e);
  }
}

export async function suggestHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { q } = suggestParams.parse(req.query);
    const cacheKey = `suggest:${q.toLowerCase()}`;
    const hit = await cache.get(cacheKey);
    if (hit) {
      res.json(JSON.parse(hit) as string[]);
      return;
    }

    const rows = await prisma.keyword.findMany({
      where: { word: { startsWith: q.toLowerCase() } },
      select: { word: true, tfidf: true },
      take: 80,
    });
    const byWord = new Map<string, number>();
    for (const r of rows) {
      const prev = byWord.get(r.word) ?? 0;
      byWord.set(r.word, prev + r.tfidf);
    }
    const suggestions = [...byWord.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([w]) => w);
    await cache.set(cacheKey, JSON.stringify(suggestions), 600);
    res.json(suggestions);
  } catch (e) {
    next(e);
  }
}
