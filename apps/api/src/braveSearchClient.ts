import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { senkoConfig } from '@senko/shared';
import type { SearchResponse, SearchResult, IndexedPage, IndexedImage, IndexedVideo } from '@senko/shared';

const BASE = 'https://api.search.brave.com/res/v1';

function id(prefix: string, url: string): string {
  const h = createHash('sha256').update(url).digest('hex').slice(0, 16);
  return `${prefix}:${h}`;
}

function braveToken(): string | null {
  const t = senkoConfig.search.braveApiKey?.trim();
  return t || null;
}

export function isBraveSearchConfigured(): boolean {
  return Boolean(braveToken());
}

/** Brave JSON image/video thumbs use the same base64 proxy segments as HTML image search. */
function decodeBraveVideoThumbProxy(src: string): string | null {
  const m = src.match(/\/g:ce\/([^?]+)/);
  if (!m?.[1]) return null;
  const b64 = m[1].replace(/\//g, '');
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  try {
    const decoded = Buffer.from(b64 + pad, 'base64').toString('utf8');
    return decoded.startsWith('http') ? decoded : null;
  } catch {
    return null;
  }
}

function resolvedBraveVideoThumbnail(src: string | undefined): string | null {
  if (!src) return null;
  if (src.includes('imgs.search.brave.com') && src.includes('/g:ce/')) {
    return decodeBraveVideoThumbProxy(src);
  }
  return src.startsWith('http') ? src : null;
}

function youtubeThumbFallbackFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com') && u.pathname === '/watch') {
      const id = u.searchParams.get('v');
      return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
    }
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function videoPlatformLabel(hostname: string | undefined, pageUrl: string): string {
  const h = (hostname ?? '').replace(/^www\./, '').toLowerCase();
  if (h.includes('youtube') || h === 'youtu.be') return 'YouTube';
  if (h.includes('vimeo')) return 'Vimeo';
  if (h.includes('dailymotion')) return 'Dailymotion';
  if (h.includes('twitch')) return 'Twitch';
  if (h.includes('tiktok')) return 'TikTok';
  if (h) {
    const head = h.split('.')[0] ?? h;
    return head ? head.charAt(0).toUpperCase() + head.slice(1) : 'Web';
  }
  try {
    const host = new URL(pageUrl).hostname.replace(/^www\./, '');
    const head = host.split('.')[0] ?? host;
    return head ? head.charAt(0).toUpperCase() + head.slice(1) : 'Web';
  } catch {
    return 'Web';
  }
}

/** Query completions from Brave (open web), empty if not configured or on error. */
export async function braveSuggest(q: string): Promise<string[]> {
  const token = braveToken();
  if (!token || !q.trim()) return [];
  try {
    const json = (await braveGet('/suggest/search', { q: q.trim() }, { timeoutMs: 2_500 })) as {
      suggestions?: { query?: string; text?: string; q?: string }[] | string[];
    };
    const raw = json.suggestions ?? [];
    if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'string') {
      return (raw as string[]).map((s) => s.trim()).filter(Boolean).slice(0, 12);
    }
    return (raw as { query?: string; text?: string; q?: string }[])
      .map((r) => r.query ?? r.text ?? r.q ?? '')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12);
  } catch {
    return [];
  }
}

type WebSafe = 'strict' | 'moderate' | 'off';

function safeParam(safe: boolean): WebSafe {
  return safe ? 'strict' : 'off';
}

async function braveGet(
  path: string,
  params: Record<string, string>,
  opts: { timeoutMs?: number } = {},
): Promise<unknown> {
  const token = braveToken();
  if (!token) throw new Error('BRAVE_SEARCH_API_KEY is not set');

  const timeoutMs = opts.timeoutMs ?? 25_000;
  const qs = new URLSearchParams(params);
  const res = await fetch(`${BASE}${path}?${qs}`, {
    headers: {
      'X-Subscription-Token': token,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Brave API ${path} ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.json();
}

function pageToWebResult(url: string, title: string | null, description: string | null, rank: number): SearchResult {
  const score = 200 - rank * 0.5;
  const row: IndexedPage = {
    id: id('brave', url),
    url,
    title,
    description,
    bodyText: null,
    wordCount: 0,
    rankScore: score,
    crawledAt: new Date(),
    language: null,
    headings: [],
    canonicalUrl: null,
  };
  return { type: 'web', score, data: row };
}

export async function braveWebSearch(
  q: string,
  page: number,
  perPage: number,
  safe: boolean,
): Promise<SearchResponse> {
  const count = Math.min(Math.max(perPage, 1), 20);
  const offset = (page - 1) * count;
  const json = (await braveGet('/web/search', {
    q,
    count: String(count),
    offset: String(offset),
    safesearch: safeParam(safe),
  })) as {
    web?: { results?: { title?: string; url?: string; description?: string }[] };
    query?: { more_results_available?: boolean };
  };

  const raw = json.web?.results ?? [];
  const results: SearchResult[] = raw
    .filter((r) => r.url?.startsWith('http'))
    .map((r, i) => pageToWebResult(r.url!, r.title ?? null, r.description ?? null, i));

  const baseTotal = offset + results.length;
  const totalResults = json.query?.more_results_available ? baseTotal + 50_000 : baseTotal;

  return {
    query: q,
    type: 'web',
    page,
    perPage,
    totalResults,
    results,
  };
}

export async function braveImageSearch(
  q: string,
  page: number,
  perPage: number,
  safe: boolean,
): Promise<SearchResponse> {
  const count = Math.min(Math.max(perPage, 1), 100);
  const offset = (page - 1) * count;
  const json = (await braveGet('/images/search', {
    q,
    count: String(count),
    offset: String(offset),
    safesearch: safeParam(safe),
  })) as {
    results?: {
      title?: string;
      url?: string;
      source?: string;
      properties?: { url?: string; thumbnail?: { src?: string }; placeholder?: string };
    }[];
  };

  const raw = json.results ?? [];
  const results: SearchResult[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i]!;
    const imageUrl = r.properties?.url || r.url;
    if (!imageUrl?.startsWith('http')) continue;
    const pageUrl = r.source?.startsWith('http') ? r.source : imageUrl;
    const img: IndexedImage = {
      id: id('braveimg', imageUrl),
      url: imageUrl,
      pageUrl,
      altText: r.title ?? null,
      width: null,
      height: null,
      format: null,
      crawledAt: new Date(),
    };
    results.push({ type: 'image', score: 150 - i * 0.4, data: img });
  }

  return {
    query: q,
    type: 'image',
    page,
    perPage,
    totalResults: offset + results.length + (results.length >= count ? 500 : 0),
    results,
  };
}

export async function braveVideoSearch(
  q: string,
  page: number,
  perPage: number,
  safe: boolean,
): Promise<SearchResponse> {
  const count = Math.min(Math.max(perPage, 1), 20);
  const offset = (page - 1) * count;
  const json = (await braveGet('/videos/search', {
    q,
    count: String(count),
    offset: String(offset),
    safesearch: safeParam(safe),
  })) as {
    results?: {
      title?: string;
      url?: string;
      description?: string;
      thumbnail?: { src?: string };
      meta_url?: { hostname?: string };
    }[];
  };

  const raw = json.results ?? [];
  const results: SearchResult[] = raw
    .filter((r) => r.url?.startsWith('http'))
    .map((r, i) => {
      const vid: IndexedVideo = {
        id: id('bravevid', r.url!),
        url: r.url!,
        pageUrl: r.url!,
        title: r.title ?? null,
        description: r.description ?? null,
        thumbnailUrl:
          resolvedBraveVideoThumbnail(r.thumbnail?.src) ?? youtubeThumbFallbackFromUrl(r.url!),
        duration: null,
        platform: videoPlatformLabel(r.meta_url?.hostname, r.url!),
        crawledAt: new Date(),
      };
      return { type: 'video' as const, score: 160 - i * 0.45, data: vid };
    });

  return {
    query: q,
    type: 'video',
    page,
    perPage,
    totalResults: offset + results.length + (results.length >= count ? 500 : 0),
    results,
  };
}

export async function braveNewsSearch(
  q: string,
  page: number,
  perPage: number,
  safe: boolean,
): Promise<SearchResponse> {
  const count = Math.min(Math.max(perPage, 1), 20);
  const offset = (page - 1) * count;
  const json = (await braveGet('/news/search', {
    q,
    count: String(count),
    offset: String(offset),
    safesearch: safeParam(safe),
  })) as {
    results?: { title?: string; url?: string; description?: string }[];
  };

  const raw = json.results ?? [];
  const results: SearchResult[] = raw
    .filter((r) => r.url?.startsWith('http'))
    .map((r, i) => pageToWebResult(r.url!, r.title ?? null, r.description ?? null, i));

  return {
    query: q,
    type: 'news',
    page,
    perPage,
    totalResults: offset + results.length + (results.length >= count ? 2000 : 0),
    results,
  };
}

function webUrl(r: SearchResult): string | null {
  if (r.type !== 'web') return null;
  return (r.data as IndexedPage).url;
}

export async function hybridWebSearch(
  q: string,
  page: number,
  perPage: number,
  safe: boolean,
  localSearch: () => Promise<SearchResponse>,
): Promise<SearchResponse> {
  const emptyBrave = (): SearchResponse => ({
    query: q,
    type: 'web',
    page,
    perPage,
    totalResults: 0,
    results: [],
  });
  const [remote, local] = await Promise.all([
    braveWebSearch(q, page, perPage, safe).catch(() => emptyBrave()),
    localSearch(),
  ]);
  const seen = new Set<string>();
  const merged: SearchResult[] = [];
  for (const r of [...remote.results, ...local.results]) {
    const u = webUrl(r);
    if (!u || seen.has(u)) continue;
    seen.add(u);
    merged.push(r);
  }
  return {
    query: q,
    type: 'web',
    page,
    perPage,
    totalResults: Math.max(local.totalResults, remote.totalResults, merged.length),
    results: merged.slice(0, perPage),
  };
}
