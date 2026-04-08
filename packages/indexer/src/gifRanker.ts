import { Prisma } from '@prisma/client';
import { prisma } from '@senko/db';
import type { SearchResponse, SearchResult } from '@senko/shared';
import type { ParsedQuery } from './queryParser.js';

export class GifRanker {
  async search(query: ParsedQuery, page: number, perPage: number, options?: { safe?: boolean }): Promise<SearchResponse> {
    const q = [query.phrase, ...query.terms].filter(Boolean).join(' ').trim();
    if (!q) {
      return { query: '', type: 'gif', page, perPage, totalResults: 0, results: [] };
    }
    const offset = (page - 1) * perPage;
    const safe = options?.safe !== false;

    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        url: string;
        pageUrl: string;
        altText: string | null;
        width: number | null;
        height: number | null;
        crawledAt: Date;
        animated: boolean;
        rank: number;
      }>
    >(Prisma.sql`
      SELECT g.id, g.url, g."pageUrl", g."altText", g.width, g.height, g."crawledAt", g.animated,
        ts_rank(
          to_tsvector('english', coalesce(g."altText", '') || ' ' || coalesce(g.url, '')),
          plainto_tsquery('english', ${q})
        ) AS rank
      FROM "Gif" g
      WHERE to_tsvector('english', coalesce(g."altText", '') || ' ' || coalesce(g.url, ''))
        @@ plainto_tsquery('english', ${q})
        AND (${safe}::boolean = false OR g."safeFlag" = true)
    `);

    const scored = rows
      .map((r) => {
        const animBonus = r.animated ? 0.1 : 0;
        const score = Number(r.rank) + animBonus;
        return { r, score };
      })
      .sort((a, b) => b.score - a.score);

    const slice = scored.slice(offset, offset + perPage);
    const results: SearchResult[] = slice.map(({ r, score }) => ({
      type: 'gif' as const,
      score,
      data: {
        id: r.id,
        url: r.url,
        pageUrl: r.pageUrl,
        altText: r.altText,
        width: r.width,
        height: r.height,
        crawledAt: r.crawledAt,
      },
    }));

    return {
      query: q,
      type: 'gif',
      page,
      perPage,
      totalResults: scored.length,
      results,
    };
  }
}
