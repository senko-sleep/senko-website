import type { Request, Response, NextFunction } from 'express';
import { cache } from '../redis.js';

const TRENDING_KEY = 'senko:trending';

export async function trendingHandler(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rows = await cache.zrevrangeWithScores(TRENDING_KEY, 0, 9);
    const trending = rows.map((r) => ({ query: r.member, score: r.score }));
    res.json({ trending });
  } catch (e) {
    next(e);
  }
}
