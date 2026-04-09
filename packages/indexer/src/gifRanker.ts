import { Prisma } from '@prisma/client';
import { prisma } from '@senko/db';
import type { SearchResponse, SearchResult, SearchCache } from '@senko/shared';
import type { ParsedQuery } from './queryParser.js';

export class GifRanker {
  constructor(private readonly cache?: SearchCache) {}

  async search(query: ParsedQuery, page: number, perPage: number, options?: { safe?: boolean }): Promise<SearchResponse> {
    const q = [query.phrase, ...query.terms].filter(Boolean).join(' ').trim();
    if (!q) {
      return { query: '', type: 'gif', page, perPage, totalResults: 0, results: [] };
    }
    const offset = (page - 1) * perPage;
    const safe = options?.safe !== false;
    const cacheKey = `search:gif:${q}:${page}:${perPage}:${safe ? '1' : '0'}`;

    if (this.cache) {
      const hit = await this.cache.get(cacheKey);
      if (hit) return JSON.parse(hit) as SearchResponse;
    }

    const totalRows = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS total
      FROM "Gif" g
      WHERE to_tsvector('english', coalesce(g."altText", '') || ' ' || coalesce(g.url, ''))
        @@ plainto_tsquery('english', ${q})
        AND (${safe}::boolean = false OR g."safeFlag" = true)
    `);

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
        score: number;
      }>
    >(Prisma.sql`
      SELECT g.id, g.url, g."pageUrl", g."altText", g.width, g.height, g."crawledAt", g.animated,
        (
          ts_rank(
          to_tsvector('english', coalesce(g."altText", '') || ' ' || coalesce(g.url, '')),
          plainto_tsquery('english', ${q})
          )
          + CASE WHEN g.animated THEN 0.1 ELSE 0 END
        ) AS score
      FROM "Gif" g
      WHERE to_tsvector('english', coalesce(g."altText", '') || ' ' || coalesce(g.url, ''))
        @@ plainto_tsquery('english', ${q})
        AND (${safe}::boolean = false OR g."safeFlag" = true)
      ORDER BY score DESC, g."crawledAt" DESC
      LIMIT ${perPage} OFFSET ${offset}
    `);

    const results: SearchResult[] = rows.map((r) => ({
      type: 'gif' as const,
      score: Number(r.score),
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

    const response: SearchResponse = {
      query: q,
      type: 'gif',
      page,
      perPage,
      totalResults: Number(totalRows[0]?.total ?? 0),
      results,
    };

    if (this.cache) {
      await this.cache.set(cacheKey, JSON.stringify(response), 300);
    }

    return response;
  }
}
