import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { QueryParser, WebRanker, ImageRanker, VideoRanker, GifRanker } from '@senko/indexer';
import { type SearchResponse, senkoConfig } from '@senko/shared';
import { prisma } from '@senko/db';
import { cache } from '../redis.js';
import {
  isBraveSearchConfigured,
  braveWebSearch,
  braveImageSearch,
  braveVideoSearch,
  braveNewsSearch,
  hybridWebSearch,
  braveSuggest,
} from '../braveSearchClient.js';
import {
  metaWebSearch,
  metaImageSearch,
  metaVideoSearch,
  metaNewsSearch,
  hybridMetaWebSearch,
  ddgAcSuggest,
} from '../freeMetaSearchClient.js';

const searchParams = z.object({
  q: z.string().min(1),
  type: z.enum(['web', 'image', 'video', 'gif', 'all', 'news']).optional(),
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(150).default(10),
  safe: z.coerce.number().optional(),
});

const suggestParams = z.object({
  q: z.string().min(1),
});

const parser = new QueryParser();
const webRanker = new WebRanker(cache);
const imageRanker = new ImageRanker(cache);
const videoRanker = new VideoRanker(cache);
const gifRanker = new GifRanker(cache);
const TRENDING_KEY = 'senko:trending';

function normalizeSuggestion(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function addSuggestionScore(scores: Map<string, number>, raw: string, score: number): void {
  const normalized = normalizeSuggestion(raw);
  if (!normalized) return;
  const key = normalized.toLowerCase();
  scores.set(key, (scores.get(key) ?? 0) + score);
}

function trimSuggestionSource(text: string): string {
  const compact = normalizeSuggestion(text);
  if (!compact) return '';
  const trimmed = compact
    .replace(/\s+[|:]\s+.*$/, '')
    .replace(/\s+-\s+(wikipedia|youtube|reddit|fandom|official site|official).*$/i, '');
  return normalizeSuggestion(trimmed);
}

const SUGGEST_WEAK_TAIL = new Set([
  'and',
  'or',
  'the',
  'a',
  'an',
  'of',
  'for',
  'to',
  'in',
  'on',
  'with',
]);

function stripWeakSuggestionTail(phrase: string): string {
  const parts = normalizeSuggestion(phrase).split(/\s+/).filter(Boolean);
  while (parts.length > 1 && SUGGEST_WEAK_TAIL.has(parts[parts.length - 1]!.toLowerCase())) {
    parts.pop();
  }
  return normalizeSuggestion(parts.join(' '));
}

function phraseFromText(text: string, query: string): string | null {
  const cleaned = trimSuggestionSource(text);
  if (!cleaned) return null;

  const lowerText = cleaned.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const at = lowerText.indexOf(lowerQuery);
  if (at < 0) return null;

  const remainder = cleaned.slice(at).trim();
  const words = remainder.split(/\s+/).slice(0, 6);
  if (words.length === 0) return null;
  const out = stripWeakSuggestionTail(words.join(' '));
  return out.toLowerCase().includes(lowerQuery) ? out : null;
}

function resolvedSafe(req: Request, parsedSafe: number | undefined): boolean {
  const raw = req.query.safe;
  /** Duplicated `safe` query keys are unusual; prefer the last value (final toggle / link wins). */
  const q = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  const s = q !== undefined && q !== null ? String(q).trim() : '';
  const n = typeof parsedSafe === 'number' && Number.isFinite(parsedSafe) ? parsedSafe : NaN;
  if (s === '0' || s.toLowerCase() === 'false' || n === 0) return false;
  if (s === '1' || s.toLowerCase() === 'true' || n === 1) return true;
  return true;
}

/** Suggest must stay snappy: slow DB or Redis must not block the bar for tens of seconds. */
const SUGGEST_DB_BUDGET_MS = 4_000;
const SUGGEST_CACHE_BUDGET_MS = 2_000;

function withBudget<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('suggest-budget')), ms);
    }),
  ]);
}

/** Never hard-fail open-web: fall back to your crawl if every engine is empty or errors. */
async function openWebOrFallback(
  fetchOpen: () => Promise<SearchResponse>,
  fetchLocal: () => Promise<SearchResponse>,
): Promise<SearchResponse> {
  try {
    const b = await fetchOpen();
    if (b.results.length > 0) return b;
  } catch {
    /* rate limits / HTML changes */
  }
  return fetchLocal();
}

function useLocalIndexOnly(): boolean {
  return senkoConfig.search.webProvider === 'local';
}

/** Official Brave JSON API (paid / dashboard key). */
function useBraveJsonApi(): boolean {
  return senkoConfig.search.webProvider === 'brave' && isBraveSearchConfigured();
}

/** Meta HTML search (no API keys). */
function useMetaSearch(): boolean {
  return !useLocalIndexOnly() && !useBraveJsonApi();
}

function useCrawlHybridWeb(): boolean {
  return senkoConfig.search.webProvider === 'hybrid';
}

export async function searchHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const t0 = Date.now();
    const parsed = searchParams.parse(req.query);
    const searchType = parsed.type ?? 'web';
    const pq = parser.parse(
      parsed.q,
      searchType === 'news' ? 'news' : searchType === 'all' ? 'all' : searchType,
    );
    const safe = resolvedSafe(req, parsed.safe);

    let body: SearchResponse;

    if (searchType === 'all') {
      if (useBraveJsonApi()) {
        const webP: Promise<SearchResponse> = useCrawlHybridWeb()
          ? hybridWebSearch(parsed.q, parsed.page, parsed.perPage, safe, () =>
              webRanker.search({ ...pq, type: 'web' }, parsed.page, parsed.perPage, { safe }),
            )
          : braveWebSearch(parsed.q, parsed.page, parsed.perPage, safe);
        const [w, i, v, g] = await Promise.all([
          webP,
          braveImageSearch(parsed.q, parsed.page, parsed.perPage, safe),
          braveVideoSearch(parsed.q, parsed.page, parsed.perPage, safe),
          gifRanker.search({ ...pq, type: 'gif' }, parsed.page, parsed.perPage, { safe }),
        ]);
        const merged = [...w.results, ...i.results, ...v.results, ...g.results].sort((a, b) => b.score - a.score);
        body = {
          query: parsed.q,
          type: 'all',
          page: parsed.page,
          perPage: parsed.perPage,
          totalResults: w.totalResults + i.totalResults + v.totalResults + g.totalResults,
          results: merged.slice(0, parsed.perPage),
        };
      } else if (useMetaSearch()) {
        const webP = openWebOrFallback(
          () =>
            useCrawlHybridWeb()
              ? hybridMetaWebSearch(
                  parsed.q,
                  parsed.page,
                  parsed.perPage,
                  () => webRanker.search({ ...pq, type: 'web' }, parsed.page, parsed.perPage, { safe }),
                  safe,
                )
              : metaWebSearch(parsed.q, parsed.page, parsed.perPage, safe),
          () => webRanker.search({ ...pq, type: 'web' }, parsed.page, parsed.perPage, { safe }),
        );
        const [w, i, v, g] = await Promise.all([
          webP,
          openWebOrFallback(
            () => metaImageSearch(parsed.q, parsed.page, parsed.perPage, safe),
            () => imageRanker.search({ ...pq, type: 'image' }, parsed.page, parsed.perPage, { safe }),
          ),
          openWebOrFallback(
            () => metaVideoSearch(parsed.q, parsed.page, parsed.perPage, safe),
            () => videoRanker.search({ ...pq, type: 'video' }, parsed.page, parsed.perPage, { safe }),
          ),
          gifRanker.search({ ...pq, type: 'gif' }, parsed.page, parsed.perPage, { safe }),
        ]);
        const merged = [...w.results, ...i.results, ...v.results, ...g.results].sort((a, b) => b.score - a.score);
        body = {
          query: parsed.q,
          type: 'all',
          page: parsed.page,
          perPage: parsed.perPage,
          totalResults: w.totalResults + i.totalResults + v.totalResults + g.totalResults,
          results: merged.slice(0, parsed.perPage),
        };
      } else {
        const [w, i, v, g] = await Promise.all([
          webRanker.search({ ...pq, type: 'web' }, parsed.page, parsed.perPage, { safe }),
          imageRanker.search({ ...pq, type: 'image' }, parsed.page, parsed.perPage, { safe }),
          videoRanker.search({ ...pq, type: 'video' }, parsed.page, parsed.perPage, { safe }),
          gifRanker.search({ ...pq, type: 'gif' }, parsed.page, parsed.perPage, { safe }),
        ]);
        const merged = [...w.results, ...i.results, ...v.results, ...g.results].sort((a, b) => b.score - a.score);
        body = {
          query: parsed.q,
          type: 'all',
          page: parsed.page,
          perPage: parsed.perPage,
          totalResults: w.totalResults + i.totalResults + v.totalResults + g.totalResults,
          results: merged.slice(0, parsed.perPage),
        };
      }
    } else if (searchType === 'news') {
      body = useBraveJsonApi()
        ? await braveNewsSearch(parsed.q, parsed.page, parsed.perPage, safe)
        : useMetaSearch()
          ? await openWebOrFallback(
              () => metaNewsSearch(parsed.q, parsed.page, parsed.perPage, safe),
              () =>
                webRanker.search({ ...pq, type: 'web' }, parsed.page, parsed.perPage, {
                  safe,
                  newsOnly: true,
                }),
            )
          : await webRanker.search({ ...pq, type: 'web' }, parsed.page, parsed.perPage, {
              safe,
              newsOnly: true,
            });
    } else if (searchType === 'web') {
      body = useBraveJsonApi()
        ? useCrawlHybridWeb()
          ? await hybridWebSearch(parsed.q, parsed.page, parsed.perPage, safe, () =>
              webRanker.search({ ...pq, type: 'web' }, parsed.page, parsed.perPage, { safe }),
            )
          : await braveWebSearch(parsed.q, parsed.page, parsed.perPage, safe)
        : useMetaSearch()
          ? await openWebOrFallback(
              () =>
                useCrawlHybridWeb()
                  ? hybridMetaWebSearch(
                      parsed.q,
                      parsed.page,
                      parsed.perPage,
                      () => webRanker.search({ ...pq, type: 'web' }, parsed.page, parsed.perPage, { safe }),
                      safe,
                    )
                  : metaWebSearch(parsed.q, parsed.page, parsed.perPage, safe),
              () => webRanker.search({ ...pq, type: 'web' }, parsed.page, parsed.perPage, { safe }),
            )
          : await webRanker.search({ ...pq, type: 'web' }, parsed.page, parsed.perPage, { safe });
    } else if (searchType === 'image') {
      body = useBraveJsonApi()
        ? await braveImageSearch(parsed.q, parsed.page, parsed.perPage, safe)
        : useMetaSearch()
          ? await openWebOrFallback(
              () => metaImageSearch(parsed.q, parsed.page, parsed.perPage, safe),
              () => imageRanker.search({ ...pq, type: 'image' }, parsed.page, parsed.perPage, { safe }),
            )
          : await imageRanker.search({ ...pq, type: 'image' }, parsed.page, parsed.perPage, { safe });
    } else if (searchType === 'video') {
      body = useBraveJsonApi()
        ? await braveVideoSearch(parsed.q, parsed.page, parsed.perPage, safe)
        : useMetaSearch()
          ? await openWebOrFallback(
              () => metaVideoSearch(parsed.q, parsed.page, parsed.perPage, safe),
              () => videoRanker.search({ ...pq, type: 'video' }, parsed.page, parsed.perPage, { safe }),
            )
          : await videoRanker.search({ ...pq, type: 'video' }, parsed.page, parsed.perPage, { safe });
    } else {
      body = await gifRanker.search({ ...pq, type: 'gif' }, parsed.page, parsed.perPage, { safe });
    }

    try {
      await cache.zincrby('senko:trending', 1, parsed.q.toLowerCase());
    } catch {}

    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    res.setHeader('X-Search-Time', String(Date.now() - t0));
    res.json(body);
  } catch (e) {
    next(e);
  }
}

export async function suggestHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { q } = suggestParams.parse(req.query);
    const normalizedQuery = q.trim().toLowerCase();
    const cacheKey = `suggest:${normalizedQuery}`;
    const hit = await cache.get(cacheKey);
    if (hit) {
      res.json(JSON.parse(hit) as string[]);
      return;
    }

    let suggestions: string[] = [];
    try {
      const [ddgLive, braveLive, trendingRows, pages, keywords, images] = await Promise.all([
        normalizedQuery.length >= 2 ? ddgAcSuggest(q.trim()) : Promise.resolve([] as string[]),
        isBraveSearchConfigured() && normalizedQuery.length >= 2
          ? braveSuggest(q.trim())
          : Promise.resolve([] as string[]),
        withBudget(cache.zrevrangeWithScores(TRENDING_KEY, 0, 49), SUGGEST_CACHE_BUDGET_MS).catch(() => []),
        withBudget(
          prisma.page.findMany({
            where: {
              OR: [
                { title: { contains: normalizedQuery, mode: 'insensitive' } },
                { description: { contains: normalizedQuery, mode: 'insensitive' } },
                { bodyText: { contains: normalizedQuery, mode: 'insensitive' } },
              ],
            },
            select: { title: true, description: true, headings: true, rankScore: true },
            orderBy: { rankScore: 'desc' },
            take: 25,
          }),
          SUGGEST_DB_BUDGET_MS,
        ).catch(() => []),
        withBudget(
          prisma.keyword.findMany({
            where: { word: { startsWith: normalizedQuery } },
            select: { word: true, tfidf: true },
            take: 40,
          }),
          SUGGEST_DB_BUDGET_MS,
        ).catch(() => []),
        withBudget(
          prisma.image.findMany({
            where: { altText: { contains: normalizedQuery, mode: 'insensitive' } },
            select: { altText: true },
            take: 30,
          }),
          SUGGEST_DB_BUDGET_MS,
        ).catch(() => []),
      ]);

      const scores = new Map<string, number>();

      for (const term of ddgLive) {
        addSuggestionScore(scores, term, 180);
      }

      for (const term of braveLive) {
        addSuggestionScore(scores, term, 140);
      }

      for (const row of trendingRows) {
        if (row.member.toLowerCase().startsWith(normalizedQuery)) {
          addSuggestionScore(scores, row.member, 200 + row.score);
        }
      }

      for (const page of pages) {
        const phraseCandidates = [
          page.title,
          page.description,
          ...page.headings,
        ]
          .filter((value): value is string => Boolean(value))
          .map((value) => phraseFromText(value, normalizedQuery))
          .filter((value): value is string => Boolean(value));

        for (const candidate of phraseCandidates) {
          addSuggestionScore(scores, candidate, 80 + page.rankScore);
        }
      }

      for (const row of keywords) {
        addSuggestionScore(scores, row.word, row.tfidf);
      }

      for (const row of images) {
        if (!row.altText) continue;
        const phrase = phraseFromText(row.altText, normalizedQuery);
        if (phrase) addSuggestionScore(scores, phrase, 42);
      }

      suggestions = [...scores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([text]) => text);
      await cache.set(cacheKey, JSON.stringify(suggestions), 600);
    } catch {
      suggestions = [];
    }
    res.setHeader('Cache-Control', 'public, max-age=600, stale-while-revalidate=3600');
    res.json(suggestions);
  } catch (e) {
    next(e);
  }
}
