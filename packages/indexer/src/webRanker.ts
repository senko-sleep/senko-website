import { Prisma } from '@prisma/client';
import { prisma } from '@senko/db';
import type { SearchResponse, SearchResult, SearchCache } from '@senko/shared';
import type { ParsedQuery } from './queryParser.js';

const NEWS_DOMAINS = new Set([
  'reuters.com',
  'apnews.com',
  'bbc.com',
  'cnn.com',
  'nytimes.com',
  'theguardian.com',
  'npr.org',
  'washingtonpost.com',
]);

export class WebRanker {
  constructor(private readonly redis?: SearchCache) {}

  async search(
    query: ParsedQuery,
    page: number,
    perPage: number,
    options?: { safe?: boolean; newsOnly?: boolean },
  ): Promise<SearchResponse> {
    const q = [query.phrase, ...query.terms].filter(Boolean).join(' ').trim();
    if (!q) {
      return {
        query: '',
        type: options?.newsOnly ? 'news' : 'web',
        page,
        perPage,
        totalResults: 0,
        results: [],
      };
    }

    const cacheKey = `search:web:${q}:${page}:${options?.newsOnly ? 'news' : 'web'}:${options?.safe !== false ? '1' : '0'}`;
    if (this.redis) {
      const hit = await this.redis.get(cacheKey);
      if (hit) {
        return JSON.parse(hit) as SearchResponse;
      }
    }

    const offset = (page - 1) * perPage;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const safe = options?.safe !== false;
    const newsDomainConditions = [...NEWS_DOMAINS].map(
      (domain) => `p.url ILIKE '%${domain.replace(/'/g, "''")}%'`,
    );
    const newsWhereSql = options?.newsOnly
      ? Prisma.raw(`AND (${newsDomainConditions.join(' OR ')})`)
      : Prisma.sql``;

    const totalRows = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS total
      FROM "Page" p
      WHERE to_tsvector('english', coalesce(p.title, '') || ' ' || coalesce(p.description, '') || ' ' || coalesce(p."bodyText", ''))
        @@ plainto_tsquery('english', ${q})
        AND (${safe}::boolean = false OR p."safeFlag" = true)
        ${newsWhereSql}
    `);

    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        url: string;
        title: string | null;
        description: string | null;
        bodyText: string | null;
        wordCount: number;
        rankScore: number;
        crawledAt: Date;
        language: string | null;
        headings: string[];
        fts_rank: number;
      }>
    >(Prisma.sql`
      SELECT p.id, p.url, p.title, p.description, p."bodyText", p."wordCount", p."rankScore", p."crawledAt", p.language, p.headings,
        ts_rank(
          to_tsvector('english', coalesce(p.title, '') || ' ' || coalesce(p.description, '') || ' ' || coalesce(p."bodyText", '')),
          plainto_tsquery('english', ${q})
        ) AS fts_rank
      FROM "Page" p
      WHERE to_tsvector('english', coalesce(p.title, '') || ' ' || coalesce(p.description, '') || ' ' || coalesce(p."bodyText", ''))
        @@ plainto_tsquery('english', ${q})
        AND (${safe}::boolean = false OR p."safeFlag" = true)
        ${newsWhereSql}
      ORDER BY fts_rank DESC, p."rankScore" DESC, p."crawledAt" DESC
      LIMIT ${Math.max(perPage * 5, 50)} OFFSET ${offset}
    `);

    const termsLower = query.terms.map((t) => t.toLowerCase());
    const scored = rows
      .map((r) => {
        const title = (r.title ?? '').toLowerCase();
        const headings = (r.headings ?? []).join(' ').toLowerCase();
        const tfidfPart = Number(r.fts_rank) * 0.5;
        const titleBonus = termsLower.length > 0 && termsLower.every((t) => title.includes(t)) ? 0.3 : 0;
        const headingBonus =
          termsLower.length > 0 && termsLower.some((t) => headings.includes(t)) ? 0.15 : 0;
        const prPart = Number(r.rankScore) * 0.2;
        const fresh = new Date(r.crawledAt) >= sevenDaysAgo ? 0.05 : 0;
        const newsBoost = options?.newsOnly ? 0.05 : 0;
        const score = tfidfPart + titleBonus + headingBonus + prPart + fresh + newsBoost;
        return { r, score };
      })
      .sort((a, b) => b.score - a.score);

    const slice = scored.slice(0, perPage);
    const results: SearchResult[] = slice.map(({ r, score }) => ({
      type: 'web' as const,
      score,
      data: {
        id: r.id,
        url: r.url,
        title: r.title,
        description: r.description,
        bodyText: r.bodyText,
        wordCount: r.wordCount,
        rankScore: r.rankScore,
        crawledAt: r.crawledAt,
        language: r.language,
        headings: r.headings,
      },
    }));

    const response: SearchResponse = {
      query: q,
      type: options?.newsOnly ? 'news' : 'web',
      page,
      perPage,
      totalResults: Number(totalRows[0]?.total ?? 0),
      results,
    };

    if (this.redis) {
      await this.redis.set(cacheKey, JSON.stringify(response), 300);
    }
    return response;
  }
}
