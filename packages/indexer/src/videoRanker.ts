import { Prisma } from '@prisma/client';
import { prisma } from '@senko/db';
import type { SearchResponse, SearchResult, SearchCache } from '@senko/shared';
import type { ParsedQuery } from './queryParser.js';

export class VideoRanker {
  constructor(private readonly cache?: SearchCache) {}

  async search(query: ParsedQuery, page: number, perPage: number, options?: { safe?: boolean }): Promise<SearchResponse> {
    const q = [query.phrase, ...query.terms].filter(Boolean).join(' ').trim();
    if (!q) {
      return { query: '', type: 'video', page, perPage, totalResults: 0, results: [] };
    }
    const offset = (page - 1) * perPage;
    const safe = options?.safe !== false;
    const platformFilter = query.filters.platform?.toLowerCase();
    const hasThumb = query.filters.hasThumb ? '1' : '0';
    const cacheKey = `search:video:${q}:${page}:${perPage}:${safe ? '1' : '0'}:${platformFilter ?? ''}:${hasThumb}`;

    if (this.cache) {
      const hit = await this.cache.get(cacheKey);
      if (hit) return JSON.parse(hit) as SearchResponse;
    }

    const totalRows = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS total
      FROM "Video" v
      WHERE to_tsvector('english', coalesce(v.title, '') || ' ' || coalesce(v.description, '') || ' ' || coalesce(v.platform, ''))
        @@ plainto_tsquery('english', ${q})
        AND (${safe}::boolean = false OR v."safeFlag" = true)
        AND (${platformFilter ?? null}::text IS NULL OR lower(coalesce(v.platform, '')) = ${platformFilter ?? null})
        AND (${query.filters.hasThumb}::boolean = false OR v."thumbnailUrl" IS NOT NULL)
    `);

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
        score: number;
      }>
    >(Prisma.sql`
      SELECT v.id, v.url, v."pageUrl", v.title, v.description, v."thumbnailUrl", v.duration, v.platform, v."crawledAt",
        (
          ts_rank(
            to_tsvector('english', coalesce(v.title, '') || ' ' || coalesce(v.description, '') || ' ' || coalesce(v.platform, '')),
            plainto_tsquery('english', ${q})
          )
          + CASE WHEN lower(coalesce(v.platform, '')) IN ('youtube', 'vimeo') THEN 0.15 ELSE 0 END
          + CASE WHEN v."thumbnailUrl" IS NOT NULL THEN 0.05 ELSE 0 END
        ) AS score
      FROM "Video" v
      WHERE to_tsvector('english', coalesce(v.title, '') || ' ' || coalesce(v.description, '') || ' ' || coalesce(v.platform, ''))
        @@ plainto_tsquery('english', ${q})
        AND (${safe}::boolean = false OR v."safeFlag" = true)
        AND (${platformFilter ?? null}::text IS NULL OR lower(coalesce(v.platform, '')) = ${platformFilter ?? null})
        AND (${query.filters.hasThumb}::boolean = false OR v."thumbnailUrl" IS NOT NULL)
      ORDER BY score DESC, v."crawledAt" DESC
      LIMIT ${perPage} OFFSET ${offset}
    `);

    const results: SearchResult[] = rows.map((r) => ({
      type: 'video' as const,
      score: Number(r.score),
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

    const response: SearchResponse = {
      query: q,
      type: 'video',
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
