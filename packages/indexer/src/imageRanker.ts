import { Prisma } from '@prisma/client';
import { prisma } from '@senko/db';
import type { SearchResponse, SearchResult, SearchCache } from '@senko/shared';
import type { ParsedQuery } from './queryParser.js';

export class ImageRanker {
  constructor(private readonly cache?: SearchCache) {}

  async search(query: ParsedQuery, page: number, perPage: number, options?: { safe?: boolean }): Promise<SearchResponse> {
    const q = [query.phrase, ...query.terms].filter(Boolean).join(' ').trim();
    if (!q) {
      return { query: '', type: 'image', page, perPage, totalResults: 0, results: [] };
    }
    const offset = (page - 1) * perPage;
    const safe = options?.safe !== false;
    const fmt = query.filters.format?.toLowerCase();
    const minW = query.filters.minWidth;
    const cacheKey = `search:image:${q}:${page}:${perPage}:${safe ? '1' : '0'}:${fmt ?? ''}:${minW ?? ''}`;

    if (this.cache) {
      const hit = await this.cache.get(cacheKey);
      if (hit) return JSON.parse(hit) as SearchResponse;
    }

    const terms = query.terms.map((t) => t.toLowerCase());
    const titleMatchSql =
      terms.length > 0
        ? Prisma.sql` + CASE WHEN EXISTS (
            SELECT 1
            FROM unnest(ARRAY[${Prisma.join(terms)}]::text[]) AS term
            WHERE lower(coalesce(p.title, '')) LIKE '%' || term || '%'
          ) THEN 0.3 ELSE 0 END`
        : Prisma.sql``;
    const urlMatchSql =
      terms.length > 0
        ? Prisma.sql` + CASE WHEN EXISTS (
            SELECT 1
            FROM unnest(ARRAY[${Prisma.join(terms)}]::text[]) AS term
            WHERE lower(i.url) LIKE '%' || term || '%'
          ) THEN 0.1 ELSE 0 END`
        : Prisma.sql``;

    const totalRows = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS total
      FROM "Image" i
      LEFT JOIN "Page" p ON p.url = i."pageUrl"
      WHERE (
        to_tsvector('english', coalesce(i."altText", '') || ' ' || coalesce(i.url, ''))
        @@ plainto_tsquery('english', ${q})
        OR to_tsvector('english', coalesce(p.title, '')) @@ plainto_tsquery('english', ${q})
      )
      AND (${safe}::boolean = false OR i."safeFlag" = true)
      AND (${fmt ?? null}::text IS NULL OR lower(coalesce(i.format, '')) = ${fmt ?? null})
      AND (${minW ?? null}::int IS NULL OR coalesce(i.width, 0) >= ${minW ?? null})
    `);

    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        url: string;
        pageUrl: string;
        altText: string | null;
        width: number | null;
        height: number | null;
        format: string | null;
        crawledAt: Date;
        page_title: string | null;
        score: number;
      }>
    >(Prisma.sql`
      SELECT i.id, i.url, i."pageUrl", i."altText", i.width, i.height, i.format, i."crawledAt",
        p.title AS page_title,
        (
          ts_rank(
          to_tsvector('english', coalesce(i."altText", '') || ' ' || coalesce(i.url, '')),
          plainto_tsquery('english', ${q})
          ) * 0.6
          + CASE WHEN coalesce(i.width, 0) > 800 THEN 0.1 ELSE 0 END
          ${titleMatchSql}
          ${urlMatchSql}
        ) AS score
      FROM "Image" i
      LEFT JOIN "Page" p ON p.url = i."pageUrl"
      WHERE (
        to_tsvector('english', coalesce(i."altText", '') || ' ' || coalesce(i.url, ''))
        @@ plainto_tsquery('english', ${q})
        OR to_tsvector('english', coalesce(p.title, '')) @@ plainto_tsquery('english', ${q})
      )
      AND (${safe}::boolean = false OR i."safeFlag" = true)
      AND (${fmt ?? null}::text IS NULL OR lower(coalesce(i.format, '')) = ${fmt ?? null})
      AND (${minW ?? null}::int IS NULL OR coalesce(i.width, 0) >= ${minW ?? null})
      ORDER BY score DESC, i."crawledAt" DESC
      LIMIT ${perPage} OFFSET ${offset}
    `);

    const results: SearchResult[] = rows.map((r) => ({
      type: 'image' as const,
      score: Number(r.score),
      data: {
        id: r.id,
        url: r.url,
        pageUrl: r.pageUrl,
        altText: r.altText,
        width: r.width,
        height: r.height,
        format: r.format,
        crawledAt: r.crawledAt,
      },
    }));

    const response: SearchResponse = {
      query: q,
      type: 'image',
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
