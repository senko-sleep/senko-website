import type { Request, Response, NextFunction } from 'express';
import { prisma } from '@senko/db';
import { cache } from '../redis.js';

const TRENDING_KEY = 'senko:trending';

/** When Redis has no search-popularity data yet, expose top indexed terms (not a fixed list). */
async function trendingFromIndex(): Promise<{ query: string; score: number }[]> {
  const rows = await prisma.keyword.groupBy({
    by: ['word'],
    _sum: { tfidf: true },
    orderBy: { _sum: { tfidf: 'desc' } },
    take: 12,
  });
  return rows
    .map((r) => ({ query: r.word, score: r._sum.tfidf ?? 0 }))
    .filter((r) => r.query.length >= 2);
}

export async function trendingHandler(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rows = await cache.zrevrangeWithScores(TRENDING_KEY, 0, 9);
    let trending = rows.map((r) => ({ query: r.member, score: r.score }));

    if (trending.length === 0) {
      trending = await trendingFromIndex();
    }

    res.json({ trending });
  } catch (e) {
    next(e);
  }
}
