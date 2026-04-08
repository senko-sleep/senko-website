import type { Request, Response, NextFunction } from 'express';
import { prisma } from '@senko/db';

export async function statsHandler(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [totalPages, totalImages, totalVideos, totalGifs] = await Promise.all([
      prisma.page.count(),
      prisma.image.count(),
      prisma.video.count(),
      prisma.gif.count(),
    ]);
    res.json({ totalPages, totalImages, totalVideos, totalGifs });
  } catch (e) {
    next(e);
  }
}
