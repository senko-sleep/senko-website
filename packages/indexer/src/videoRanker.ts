import { Prisma } from '@prisma/client';
import { prisma } from '@senko/db';
import type { SearchResponse, SearchResult } from '@senko/shared';
import type { ParsedQuery } from './queryParser.js';

export class VideoRanker {
  async search(query: ParsedQuery, page: number, perPage: number, options?: { safe?: boolean }): Promise<SearchResponse> {
    const q = [query.phrase, ...query.terms].filter(Boolean).join(' ').trim();
    if (!q) {
      return { query: '', type: 'video', page, perPage, totalResults: 0, results: [] };
    }
    const offset = (page - 1) * perPage;
    const safe = options?.safe !== false;
    const platformFilter = query.filters.platform?.toLowerCase();

    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        url: string;
        pageUrl: string;
        title: string | null;
        description: string | null;
        thumbnailUrl: string | null;
        duration: number | null;
        platform: string | null;
        crawledAt: Date;
        rank: number;
      }>
    >(Prisma.sql`
      SELECT v.id, v.url, v."pageUrl", v.title, v.description, v."thumbnailUrl", v.duration, v.platform, v."crawledAt",
        ts_rank(
          to_tsvector('english', coalesce(v.title, '') || ' ' || coalesce(v.description, '') || ' ' || coalesce(v.platform, '')),
          plainto_tsquery('english', ${q})
        ) AS rank
      FROM "Video" v
      WHERE to_tsvector('english', coalesce(v.title, '') || ' ' || coalesce(v.description, '') || ' ' || coalesce(v.platform, ''))
        @@ plainto_tsquery('english', ${q})
        AND (${safe}::boolean = false OR v."safeFlag" = true)
    `);

    let filtered = rows;
    if (platformFilter && platformFilter !== 'all') {
      filtered = filtered.filter((r) => (r.platform ?? '').toLowerCase() === platformFilter);
    }
    if (query.filters.hasThumb) {
      filtered = filtered.filter((r) => !!r.thumbnailUrl);
    }

    const scored = filtered
      .map((r) => {
        let boost = 0;
        const p = (r.platform ?? '').toLowerCase();
        if (p === 'youtube' || p === 'vimeo') boost += 0.15;
        if (r.thumbnailUrl) boost += 0.05;
        const score = Number(r.rank) + boost;
        return { r, score };
      })
      .sort((a, b) => b.score - a.score);

    const slice = scored.slice(offset, offset + perPage);
    const results: SearchResult[] = slice.map(({ r, score }) => ({
      type: 'video' as const,
      score,
      data: {
        id: r.id,
        url: r.url,
        pageUrl: r.pageUrl,
        title: r.title,
        description: r.description,
        thumbnailUrl: r.thumbnailUrl,
        duration: r.duration,
        platform: r.platform,
        crawledAt: r.crawledAt,
      },
    }));

    return {
      query: q,
      type: 'video',
      page,
      perPage,
      totalResults: scored.length,
      results,
    };
  }
}
