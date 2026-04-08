import { Prisma } from '@prisma/client';
import { prisma } from '@senko/db';
import type { SearchResponse, SearchResult } from '@senko/shared';
import type { ParsedQuery } from './queryParser.js';

export class ImageRanker {
  async search(query: ParsedQuery, page: number, perPage: number, options?: { safe?: boolean }): Promise<SearchResponse> {
    const q = [query.phrase, ...query.terms].filter(Boolean).join(' ').trim();
    if (!q) {
      return { query: '', type: 'image', page, perPage, totalResults: 0, results: [] };
    }
    const offset = (page - 1) * perPage;
    const safe = options?.safe !== false;
    const fmt = query.filters.format?.toLowerCase();
    const minW = query.filters.minWidth;

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
        rank: number;
      }>
    >(Prisma.sql`
      SELECT i.id, i.url, i."pageUrl", i."altText", i.width, i.height, i.format, i."crawledAt",
        p.title AS page_title,
        ts_rank(
          to_tsvector('english', coalesce(i."altText", '') || ' ' || coalesce(i.url, '')),
          plainto_tsquery('english', ${q})
        ) AS rank
      FROM "Image" i
      LEFT JOIN "Page" p ON p.url = i."pageUrl"
      WHERE (
        to_tsvector('english', coalesce(i."altText", '') || ' ' || coalesce(i.url, ''))
        @@ plainto_tsquery('english', ${q})
        OR to_tsvector('english', coalesce(p.title, '')) @@ plainto_tsquery('english', ${q})
      )
      AND (${safe}::boolean = false OR i."safeFlag" = true)
    `);

    const terms = query.terms.map((t) => t.toLowerCase());
    let filtered = rows;
    if (fmt) {
      filtered = filtered.filter((r) => (r.format ?? '').toLowerCase() === fmt);
    }
    if (minW != null) {
      filtered = filtered.filter((r) => (r.width ?? 0) >= minW);
    }

    const scored = filtered
      .map((r) => {
        const alt = (r.altText ?? '').toLowerCase();
        const title = (r.page_title ?? '').toLowerCase();
        const slug = r.url.toLowerCase();
        const altM = terms.reduce((s, t) => s + (alt.includes(t) ? 1 : 0), 0) / Math.max(terms.length, 1);
        const altScore = Number(r.rank) * 0.6 + altM * 0.1;
        const titleScore = terms.some((t) => title.includes(t)) ? 0.3 : 0;
        const urlScore = terms.some((t) => slug.includes(t)) ? 0.1 : 0;
        const sizeBonus = (r.width ?? 0) > 800 ? 0.1 : 0;
        const score = altScore + titleScore + urlScore + sizeBonus;
        return { r, score };
      })
      .sort((a, b) => b.score - a.score);

    const slice = scored.slice(offset, offset + perPage);
    const results: SearchResult[] = slice.map(({ r, score }) => ({
      type: 'image' as const,
      score,
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

    return {
      query: q,
      type: 'image',
      page,
      perPage,
      totalResults: scored.length,
      results,
    };
  }
}
