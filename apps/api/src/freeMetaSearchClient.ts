/**
 * Open-web search without API keys: merges HTML results from several engines in parallel.
 * Respect each engine's Terms of Service; this is best-effort and may break if layouts change.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import type { SearchResponse, SearchResult, IndexedPage, IndexedImage, IndexedVideo } from '@senko/shared';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Tight budget so the API stays snappy when an engine is slow or blocked. */
const T_ENGINE_MS = 4_200;

/** Bing HTML: adult / safe filter (`adlt=off` when Senko safe search is off). */
function bingAdltParam(safe: boolean): string {
  return safe ? '&adlt=strict' : '&adlt=off';
}

/** Bing also honors `safesearch` on image/video/news endpoints — pair with `adlt`. */
function bingSafesearchParam(safe: boolean): string {
  return safe ? '&safesearch=strict' : '&safesearch=off';
}

function bingSafeQuery(safe: boolean): string {
  return `${bingAdltParam(safe)}${bingSafesearchParam(safe)}`;
}

/** Legacy Bing toggle; improves adult-off recognition on some image endpoints. */
function bingAdltSetOff(safe: boolean): string {
  return safe ? '' : '&adlt_set=off';
}

/** DuckDuckGo HTML: `kp=1` strict, `kp=-2` off (see DDG URL params). */
function ddgHtmlPath(safe: boolean): string {
  return safe ? 'https://html.duckduckgo.com/html/' : 'https://html.duckduckgo.com/html/?kp=-2';
}

function id(prefix: string, url: string): string {
  return `${prefix}:${createHash('sha256').update(url).digest('hex').slice(0, 16)}`;
}

function fetchHtml(url: string, init: RequestInit = {}): Promise<string> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(T_ENGINE_MS),
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml',
      ...((init.headers as Record<string, string>) ?? {}),
    },
  }).then(async (r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.text();
  });
}

function normalizeUrlKey(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    let host = u.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    return `${host}${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

/** Bing click-tracking: https://www.bing.com/ck/a?!&&p=...&u=a1<base64url>&ntb=1 */
function decodeBingRedirect(href: string): string {
  if (!href.includes('bing.com/ck/')) return href;
  try {
    const u = new URL(href);
    const enc = u.searchParams.get('u');
    if (enc?.startsWith('a1')) {
      const decoded = Buffer.from(enc.slice(2), 'base64url').toString('utf8');
      if (decoded.startsWith('http')) return decoded;
    }
  } catch { /* ignore */ }
  return href;
}

function decodeGoogleRedirect(href: string, base = 'https://www.google.com'): string | null {
  if (href.startsWith('http')) {
    try {
      const u = new URL(href);
      if (u.hostname.includes('google.') && u.pathname.includes('url') && u.searchParams.has('q')) {
        const q = u.searchParams.get('q');
        if (q?.startsWith('http')) return q;
      }
    } catch {
      /* ignore */
    }
    return href;
  }
  if (href.startsWith('/url?')) {
    try {
      const u = new URL(href, base);
      const q = u.searchParams.get('q');
      if (q?.startsWith('http')) return decodeURIComponent(q);
    } catch {
      /* ignore */
    }
  }
  return null;
}

interface RawHit {
  url: string;
  title: string;
  description: string;
  engine: 'ddg' | 'bing' | 'google' | 'brave';
  rank: number;
}

const ENGINE_W = { ddg: 3.2, bing: 3, brave: 2.6, google: 2.4 } as const;

function parseDdgWeb(html: string): RawHit[] {
  const $ = cheerio.load(html);
  const out: RawHit[] = [];
  const seen = new Set<string>();

  const tryRow = (el: any) => {
    const $el = $(el);
    const a = $el.find('a.result__a, a[data-testid="result-title-a"], h2 a').first();
    let href = a.attr('href')?.trim() ?? '';
    if (href.startsWith('//')) href = `https:${href}`;
    if (!href.startsWith('http')) return;
    const key = normalizeUrlKey(href);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const title = a.text().trim() || 'Untitled';
    const snippet =
      $el.find('.result__snippet, [data-result="snippet"], .OgdwYG6KE2qthn9XQWFC').first().text().trim() || '';
    out.push({ url: href, title, description: snippet, engine: 'ddg', rank: out.length });
  };

  $('.result, .web-result, article[data-testid="result"]').each((_i, el) => tryRow(el));
  if (out.length === 0) {
    $('.links_main a.result__a').each((_i, el) => {
      try {
        tryRow(el.parent?.parent);
      } catch {
        /* ignore */
      }
    });
  }
  if (out.length === 0) {
    $('a.result__a[href^="http"]').each((_i, el) => {
      const href = $(el).attr('href')?.trim() ?? '';
      const key = normalizeUrlKey(href);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push({
        url: href,
        title: $(el).text().trim(),
        description: $(el).closest('.result').find('.result__snippet').text().trim(),
        engine: 'ddg',
        rank: out.length,
      });
    });
  }
  return out.slice(0, 15);
}

function parseBingWeb(html: string): RawHit[] {
  const $ = cheerio.load(html);
  const out: RawHit[] = [];
  const seen = new Set<string>();
  $('li.b_algo').each((i, li) => {
    const $li = $(li);
    const a = $li.find('h2 a').first();
    let href = a.attr('href')?.trim() ?? '';
    if (href.startsWith('//')) href = `https:${href}`;
    href = decodeBingRedirect(href);
    if (!href.startsWith('http')) return;
    const key = normalizeUrlKey(href);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const title = a.text().trim();
    const desc = $li.find('.b_caption p, .b_algoSlug, .b_snippet').first().text().trim();
    out.push({ url: href, title, description: desc, engine: 'bing', rank: i });
  });
  return out.slice(0, 15);
}

function parseGoogleLite(html: string): RawHit[] {
  const $ = cheerio.load(html);
  const out: RawHit[] = [];
  const seen = new Set<string>();
  $('.g, div.Gx5Zad').each((i, el) => {
    const $el = $(el);
    const a = $el.find('a[href^="http"], a[href^="/url"]').first();
    let raw = a.attr('href') ?? '';
    const href = decodeGoogleRedirect(raw) ?? (raw.startsWith('http') ? raw : null);
    if (!href?.startsWith('http')) return;
    const key = normalizeUrlKey(href);
    if (!key || seen.has(key)) return;
    if (href.includes('google.com/aclk') || href.includes('youtube.com/results')) return;
    seen.add(key);
    const title = a.text().trim();
    const desc = $el.find('font[style*="font-size:small"], .VwiC3b, .yXK7lf').first().text().trim();
    out.push({ url: href, title, description: desc, engine: 'google', rank: i });
  });
  return out.slice(0, 12);
}

function parseBraveWeb(html: string): RawHit[] {
  const $ = cheerio.load(html);
  const out: RawHit[] = [];
  const seen = new Set<string>();
  $('a[href^="http"]').each((_i, el) => {
    const href = $(el).attr('href')?.trim() ?? '';
    if (!href.includes('.') || href.includes('brave.com') || href.includes('hcaptcha')) return;
    const key = normalizeUrlKey(href);
    if (!key || seen.has(key)) return;
    if (href.length > 500) return;
    seen.add(key);
    const title = $(el).text().trim() || 'Untitled';
    const desc = $(el).closest('div').find('p, .snippet, [class*="snippet"]').first().text().trim().slice(0, 400);
    if (title.length < 3) return;
    out.push({ url: href, title, description: desc, engine: 'brave', rank: out.length });
  });
  return out.slice(0, 10);
}

async function loadDdgWeb(q: string, safe: boolean): Promise<RawHit[]> {
  const body = new URLSearchParams({ q, b: '' });
  const html = await fetchHtml(ddgHtmlPath(safe), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return parseDdgWeb(html);
}

async function loadBingWeb(q: string, page: number, safe: boolean): Promise<RawHit[]> {
  const first = 1 + (page - 1) * 10;
  const u = `https://www.bing.com/search?q=${encodeURIComponent(q)}&first=${first}&FORM=PERE${bingSafeQuery(safe)}`;
  const html = await fetchHtml(u);
  return parseBingWeb(html);
}

async function loadGoogleWeb(q: string, safe: boolean): Promise<RawHit[]> {
  const safePart = safe ? '&safe=active' : '&safe=off';
  const u = `https://www.google.com/search?q=${encodeURIComponent(q)}&num=12&hl=en&gbv=1&pws=0${safePart}`;
  const html = await fetchHtml(u);
  return parseGoogleLite(html);
}

async function loadBraveWeb(q: string, safe: boolean): Promise<RawHit[]> {
  const ss = safe ? 'strict' : 'off';
  const u = `https://search.brave.com/search?q=${encodeURIComponent(q)}&source=web&safesearch=${ss}`;
  const html = await fetchHtml(u);
  return parseBraveWeb(html);
}

function mergeWebHits(lists: RawHit[][]): SearchResult[] {
  const byKey = new Map<
    string,
    { score: number; url: string; title: string; description: string; engines: Set<string> }
  >();

  for (const list of lists) {
    for (const h of list) {
      const key = normalizeUrlKey(h.url);
      if (!key) continue;
      const w = ENGINE_W[h.engine] * (12 / (h.rank + 3));
      const cur = byKey.get(key);
      if (!cur) {
        byKey.set(key, {
          score: w,
          url: h.url,
          title: h.title,
          description: h.description,
          engines: new Set([h.engine]),
        });
      } else {
        cur.score += w * 0.85;
        cur.engines.add(h.engine);
        if (h.title.length > cur.title.length) cur.title = h.title;
        if (h.description.length > cur.description.length) cur.description = h.description;
      }
    }
  }

  return [...byKey.values()]
    .sort((a, b) => b.score - a.score)
    .map((r, i) => {
      const bonus = r.engines.size * 4;
      const score = r.score + bonus + (50 - i) * 0.1;
      const row: IndexedPage = {
        id: id('meta', r.url),
        url: r.url,
        title: r.title,
        description: r.description || null,
        bodyText: null,
        wordCount: 0,
        rankScore: score,
        crawledAt: new Date(),
        language: null,
        headings: [],
        canonicalUrl: null,
      };
      return { type: 'web' as const, score, data: row };
    });
}

export async function metaWebSearch(
  q: string,
  page: number,
  perPage: number,
  safe: boolean = true,
): Promise<SearchResponse> {
  const [ddg, bing, google, brave] = await Promise.allSettled([
    loadDdgWeb(q, safe),
    loadBingWeb(q, page, safe),
    loadGoogleWeb(q, safe),
    loadBraveWeb(q, safe),
  ]);

  const lists: RawHit[][] = [];
  if (ddg.status === 'fulfilled') lists.push(ddg.value);
  if (bing.status === 'fulfilled') lists.push(bing.value);
  if (google.status === 'fulfilled') lists.push(google.value);
  if (brave.status === 'fulfilled') lists.push(brave.value);

  const merged = mergeWebHits(lists);
  const offset = (page - 1) * perPage;
  const slice = merged.slice(offset, offset + perPage);

  return {
    query: q,
    type: 'web',
    page,
    perPage,
    totalResults: merged.length === 0 ? 0 : Math.max(offset + merged.length, 250_000),
    results: slice,
  };
}

export async function hybridMetaWebSearch(
  q: string,
  page: number,
  perPage: number,
  localSearch: () => Promise<SearchResponse>,
  safe: boolean = true,
): Promise<SearchResponse> {
  const [remote, local] = await Promise.allSettled([
    metaWebSearch(q, page, perPage, safe),
    localSearch(),
  ]);

  const metaResults = remote.status === 'fulfilled' ? remote.value.results : [];
  const localResults = local.status === 'fulfilled' ? local.value.results : [];
  const seen = new Set<string>();
  const merged: SearchResult[] = [];
  for (const r of [...metaResults, ...localResults]) {
    if (r.type !== 'web') continue;
    const u = (r.data as IndexedPage).url;
    const k = normalizeUrlKey(u);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    merged.push(r);
  }
  return {
    query: q,
    type: 'web',
    page,
    perPage,
    totalResults: Math.max(
      remote.status === 'fulfilled' ? remote.value.totalResults : 0,
      local.status === 'fulfilled' ? local.value.totalResults : 0,
      merged.length,
    ),
    results: merged.slice(0, perPage),
  };
}

/** DuckDuckGo instant typeahead — no API key. */
export async function ddgAcSuggest(q: string): Promise<string[]> {
  const t = q.trim();
  if (t.length < 2) return [];
  try {
    const u = `https://duckduckgo.com/ac/?q=${encodeURIComponent(t)}&type=list`;
    const res = await fetch(u, {
      signal: AbortSignal.timeout(3_000),
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { phrase?: string }[] | string[];
    if (!Array.isArray(json)) return [];
    if (typeof json[0] === 'string') return (json as string[]).filter(Boolean).slice(0, 12);
    return (json as { phrase?: string }[])
      .map((x) => x.phrase?.trim() ?? '')
      .filter(Boolean)
      .slice(0, 12);
  } catch {
    return [];
  }
}

function parseBingImages(html: string, limit: number): SearchResult[] {
  const $ = cheerio.load(html);
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  let i = 0;
  $('a.iusc').each((_, el) => {
    if (out.length >= limit) return;
    const m = $(el).attr('m');
    if (!m) return;
    try {
      const j = JSON.parse(m.replace(/&quot;/g, '"')) as {
        murl?: string;
        turl?: string;
        purl?: string;
        t?: string;
      };
      const imageUrl = j.murl;
      if (!imageUrl?.startsWith('http')) return;
      const key = normalizeUrlKey(imageUrl);
      if (!key || seen.has(key)) return;
      seen.add(key);
      const pageUrl = j.purl?.startsWith('http') ? j.purl : imageUrl;
      const img: IndexedImage = {
        id: id('metaimg', imageUrl),
        url: imageUrl,
        pageUrl,
        altText: j.t ?? null,
        width: null,
        height: null,
        format: null,
        crawledAt: new Date(),
      };
      out.push({ type: 'image', score: 120 - i * 0.3, data: img });
      i++;
    } catch {
      /* skip */
    }
  });
  return out;
}

/** Brave proxies thumbnails as `.../g:ce/<base64url segments>` — decode to the publisher image URL. */
function decodeBraveImageProxySrc(src: string): string | null {
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

function parseBraveImages(html: string, limit: number): SearchResult[] {
  const $ = cheerio.load(html);
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  let i = 0;
  $('button.image-result').each((_, el) => {
    if (out.length >= limit) return;
    const $btn = $(el);
    const title = $btn.find('.image-metadata-title').text().trim() || null;
    const src = $btn.find('img').first().attr('src') ?? '';
    if (!src.includes('imgs.search.brave.com')) return;
    const imageUrl = decodeBraveImageProxySrc(src);
    if (!imageUrl?.startsWith('http')) return;
    const key = normalizeUrlKey(imageUrl);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const source = $btn.find('.image-metadata-source').text().trim();
    const pageUrl = source.includes('.') ? `https://${source.replace(/^www\./, '')}/` : imageUrl;
    const img: IndexedImage = {
      id: id('braveimg', imageUrl),
      url: imageUrl,
      pageUrl,
      altText: title,
      width: null,
      height: null,
      format: null,
      crawledAt: new Date(),
    };
    out.push({ type: 'image', score: 210 - i * 0.35, data: img });
    i++;
  });
  return out;
}

function mergeMetaImageResults(lists: SearchResult[][]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const list of lists) {
    for (const r of list) {
      if (r.type !== 'image') continue;
      const u = (r.data as IndexedImage).url;
      const k = normalizeUrlKey(u);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
  }
  return out;
}

function mergeMetaVideoResults(lists: SearchResult[][]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const list of lists) {
    for (const r of list) {
      if (r.type !== 'video') continue;
      const u = (r.data as IndexedVideo).url;
      const k = normalizeUrlKey(u);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Scrape a video page for direct MP4/WebM/HLS assets and a poster image. */
async function scrapePageForDirectVideo(
  pageUrl: string,
  timeout = 3_500,
): Promise<{ videoUrl: string; thumbnailUrl: string | null; title: string | null } | null> {
  let html: string;
  try {
    const res = await fetch(pageUrl, {
      signal: AbortSignal.timeout(timeout),
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: new URL(pageUrl).origin,
      },
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  const $ = cheerio.load(html);

  const ogThumb =
    $('meta[property="og:image"]').attr('content') ??
    $('meta[name="twitter:image"]').attr('content') ??
    null;
  const pageTitle =
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('title').text().trim() ||
    null;

  const absUrl = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    const t = raw.trim();
    if (t.startsWith('//')) return `https:${t}`;
    if (t.startsWith('http')) return t;
    try {
      return new URL(t, pageUrl).href;
    } catch {
      return null;
    }
  };

  const isVideoAsset = (u: string) =>
    /\.(mp4|webm|ogv|ogg|mov)(\?|#|$)/i.test(u) || u.includes('.m3u8');

  /** 1 — <video src> or <source src> */
  const directSrc =
    absUrl($('video[src]').first().attr('src')) ??
    absUrl($('video source[src]').first().attr('src')) ??
    absUrl($('source[type="video/mp4"]').first().attr('src')) ??
    absUrl($('source[type="video/webm"]').first().attr('src')) ??
    null;

  if (directSrc && isVideoAsset(directSrc)) {
    const poster = absUrl($('video').first().attr('poster')) ?? ogThumb ?? null;
    return { videoUrl: directSrc, thumbnailUrl: poster, title: pageTitle };
  }

  /** 2 — JSON-LD contentUrl / embedUrl */
  for (const script of $('script[type="application/ld+json"]').toArray()) {
    try {
      const obj = JSON.parse($(script).html() ?? '') as Record<string, unknown>;
      const entries: Record<string, unknown>[] = Array.isArray(obj)
        ? (obj as Record<string, unknown>[])
        : [obj];
      for (const entry of entries) {
        const candidates = [
          entry['contentUrl'],
          entry['embedUrl'],
          (entry['video'] as Record<string, unknown> | undefined)?.['contentUrl'],
        ]
          .map((v) => absUrl(String(v ?? '')))
          .filter((v): v is string => v !== null && isVideoAsset(v));
        if (candidates[0]) {
          return {
            videoUrl: candidates[0],
            thumbnailUrl: absUrl(String((entry['thumbnailUrl'] ?? entry['thumbnail'] ?? '') as string)) ?? ogThumb ?? null,
            title: String(entry['name'] ?? pageTitle ?? '').trim() || null,
          };
        }
      }
    } catch {
      /* skip malformed JSON */
    }
  }

  /** 3 — Regex scan inline <script> for common video URL patterns */
  const scriptText = $('script:not([src])').toArray().map((el) => $(el).html() ?? '').join('\n');
  const MP4_RE = /["'`](https?:\/\/[^"'`\s]{8,}\.(?:mp4|webm|m3u8)(?:\?[^"'`\s]*)?)/g;
  const candidates: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = MP4_RE.exec(scriptText)) !== null) {
    const u = m[1]!;
    if (!candidates.includes(u)) candidates.push(u);
    if (candidates.length >= 8) break;
  }
  if (candidates[0]) {
    return { videoUrl: candidates[0], thumbnailUrl: ogThumb ?? null, title: pageTitle };
  }

  return null;
}

/** Fan out and scrape candidate page URLs for direct video assets, respecting a wall-clock budget. */
async function enrichVideosWithDirectAssets(
  results: SearchResult[],
  budgetMs = 5_000,
): Promise<SearchResult[]> {
  const deadline = Date.now() + budgetMs;
  const enriched: SearchResult[] = [];

  await Promise.allSettled(
    results.map(async (r, idx) => {
      if (r.type !== 'video') { enriched.push(r); return; }
      const v = r.data as IndexedVideo;

      // Skip if already a direct video URL or known embeddable platform (YouTube/Vimeo handle their own)
      const host = (() => { try { return new URL(v.url).hostname.toLowerCase(); } catch { return ''; } })();
      if (
        /\.(mp4|webm|ogv|m3u8)(\?|$)/i.test(v.url) ||
        host.includes('youtube.com') || host === 'youtu.be' ||
        host.includes('vimeo.com') || host.includes('dailymotion.com')
      ) {
        enriched.push(r);
        return;
      }

      const remaining = deadline - Date.now();
      if (remaining < 400) { enriched.push(r); return; }

      const scraped = await scrapePageForDirectVideo(v.url, Math.min(remaining, 3_200));
      if (!scraped) { enriched.push(r); return; }

      const upgraded: IndexedVideo = {
        ...v,
        url: scraped.videoUrl,
        pageUrl: v.url,
        thumbnailUrl: scraped.thumbnailUrl ?? v.thumbnailUrl,
        title: scraped.title ?? v.title,
        platform: platformLabelFromVideoUrl(v.url),
      };
      enriched.push({ type: 'video', score: r.score + 30 + (results.length - idx) * 0.2, data: upgraded });
    }),
  );

  return enriched.sort((a, b) => b.score - a.score);
}

function platformLabelFromVideoUrl(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (h === 'youtu.be' || h.includes('youtube.com')) return 'YouTube';
    if (h.includes('vimeo.com')) return 'Vimeo';
    if (h.includes('dailymotion.com')) return 'Dailymotion';
    if (h.includes('twitch.tv')) return 'Twitch';
    if (h.includes('tiktok.com')) return 'TikTok';
    const head = h.split('.')[0] ?? h;
    return head ? head.charAt(0).toUpperCase() + head.slice(1) : 'Web';
  } catch {
    return 'Web';
  }
}

function youtubeVideoIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const shorts = u.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{6,24})/);
      if (shorts?.[1]) return shorts[1]!;
      const emb = u.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{6,24})/);
      if (emb?.[1]) return emb[1]!;
    }
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      return id && /^[a-zA-Z0-9_-]{6,24}$/.test(id) ? id : null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function normalizeVideoThumbSrc(raw: string | null | undefined): string | null {
  if (raw == null || !String(raw).trim()) return null;
  let t = String(raw).trim();
  if (t.startsWith('//')) t = `https:${t}`;
  if (t.startsWith('https://') || t.startsWith('http://')) return t;
  return null;
}

function bestVideoThumbnail(pageUrl: string, parsedThumb: string | null | undefined): string | null {
  const n = normalizeVideoThumbSrc(parsedThumb);
  if (n) return n;
  const yid = youtubeVideoIdFromUrl(pageUrl);
  if (yid) return `https://i.ytimg.com/vi/${yid}/hqdefault.jpg`;
  return null;
}

function resolveWatchUrlFromBingTile(hrefAttr: string, parentHtml: string): string | null {
  const blob = `${parentHtml} ${hrefAttr}`;
  const yt = blob.match(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]{6,24})/);
  if (yt?.[1]) return `https://www.youtube.com/watch?v=${yt[1]}`;
  const ytShort = blob.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{6,24})/);
  if (ytShort?.[1]) return `https://www.youtube.com/watch?v=${ytShort[1]}`;
  const tu = blob.match(/youtu\.be\/([a-zA-Z0-9_-]{6,24})/);
  if (tu?.[1]) return `https://www.youtube.com/watch?v=${tu[1]}`;
  const vm = blob.match(/vimeo\.com\/(?:video\/)?(\d{6,12})/);
  if (vm?.[1]) return `https://vimeo.com/${vm[1]}`;
  const dm = blob.match(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/);
  if (dm?.[1]) return `https://www.dailymotion.com/video/${dm[1]}`;
  let h = hrefAttr.trim();
  if (h.startsWith('//')) h = `https:${h}`;
  if (h.startsWith('http') && /youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com/i.test(h)) {
    try {
      return new URL(h).toString();
    } catch {
      return h;
    }
  }
  return null;
}

function parseBraveVideosHtml(html: string, limit: number): SearchResult[] {
  const $ = cheerio.load(html);
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  let i = 0;

  const resolveHref = (raw: string): string => {
    let h = raw.trim();
    if (h.startsWith('/url?q=') || h.startsWith('/search')) {
      try {
        const u = new URL(h, 'https://search.brave.com');
        const qv = u.searchParams.get('q') ?? u.searchParams.get('url');
        if (qv?.startsWith('http')) h = decodeURIComponent(qv);
      } catch { /* ignore */ }
    }
    if (h.startsWith('//')) h = `https:${h}`;
    return h;
  };

  $('a[href]').each((_, el) => {
    if (out.length >= limit) return false;
    const $a = $(el);
    const href = resolveHref($a.attr('href') ?? '');
    if (!isUsableVideoPageUrl(href)) return;
    const key = normalizeUrlKey(href);
    if (!key || seen.has(key)) return;

    // Only follow links that look like video pages or are inside a video result card
    const $scope = $a.closest('article, [class*="snippet"], [class*="video"], [class*="fdl"]').first();
    const inCard = $scope.length > 0;
    if (!inCard) {
      // Bare links outside cards: only accept known platforms or .mp4 hrefs
      const h = new URL(href).hostname.replace(/^www\./, '');
      const isKnownPlatform = h.includes('youtube.com') || h === 'youtu.be' ||
        h.includes('vimeo.com') || h.includes('dailymotion.com') ||
        /\.(mp4|webm|m3u8)(\?|$)/i.test(href);
      if (!isKnownPlatform) return;
    }

    seen.add(key);
    let title =
      $scope.find('h2, h3, [class*="title"]').first().text().trim() ||
      $a.attr('title')?.trim() ||
      $a.text().trim() ||
      null;
    if (title && title.length > 260) title = `${title.slice(0, 257)}…`;
    const imgsrc =
      $a.find('img').first().attr('src') ??
      $a.find('img').first().attr('data-src') ??
      $scope.find('img').first().attr('src') ??
      null;
    const vid: IndexedVideo = {
      id: id('bravevidhtml', href),
      url: href,
      pageUrl: href,
      title,
      description: null,
      thumbnailUrl: bestVideoThumbnail(href, imgsrc),
      duration: null,
      platform: platformLabelFromVideoUrl(href),
      crawledAt: new Date(),
    };
    out.push({ type: 'video', score: 155 - i * 0.38, data: vid });
    i++;
  });
  return out.slice(0, limit);
}

/** Page 1 only: extra variety vs Bing-heavy YouTube tiles; pagination stays on Bing offsets. */
async function loadBraveVideoTiles(q: string, page: number, perPage: number, safe: boolean): Promise<SearchResult[]> {
  if (page !== 1) return [];
  try {
    const ss = safe ? 'strict' : 'off';
    const html = await fetchHtml(
      `https://search.brave.com/videos?q=${encodeURIComponent(q)}&source=web&safesearch=${ss}`,
    );
    return parseBraveVideosHtml(html, Math.min(perPage, 22));
  } catch {
    return [];
  }
}

async function loadBraveImageTiles(q: string, page: number, perPage: number, safe: boolean): Promise<SearchResult[]> {
  if (safe) return [];
  /** Page 1 only: Brave HTML repeats offsets; Bing parallel fetches carry pagination. */
  if (page !== 1) return [];
  try {
    const html = await fetchHtml(
      `https://search.brave.com/images?q=${encodeURIComponent(q)}&safesearch=off`,
    );
    return parseBraveImages(html, Math.min(perPage, 100));
  } catch {
    return [];
  }
}

/** One Bing HTML page yields ~35 tiles; fan out parallel `first=` offsets to approach large `perPage`. */
const BING_IMG_STRIDE = 35;
const BING_IMG_PARALLEL = 4;

function bingImagePageUrl(q: string, first: number, safe: boolean): string {
  return `https://www.bing.com/images/search?q=${encodeURIComponent(q)}&first=${first}&FORM=HDRSC2${bingSafeQuery(safe)}${bingAdltSetOff(safe)}`;
}

async function fetchBingImagesMergedParallel(
  q: string,
  page: number,
  perPage: number,
  safe: boolean,
): Promise<SearchResult[]> {
  const parallel = Math.min(BING_IMG_PARALLEL, Math.max(1, Math.ceil(Math.min(perPage, 120) / BING_IMG_STRIDE)));
  const baseFirst = 1 + (page - 1) * BING_IMG_STRIDE * parallel;
  const urls = Array.from({ length: parallel }, (_, c) =>
    bingImagePageUrl(q, baseFirst + c * BING_IMG_STRIDE, safe),
  );
  const settled = await Promise.allSettled(
    urls.map((u) => fetchHtml(u).then((html) => parseBingImages(html, 70))),
  );
  const lists: SearchResult[][] = [];
  for (const s of settled) {
    if (s.status === 'fulfilled' && s.value.length > 0) lists.push(s.value);
  }
  return lists.length === 0 ? [] : mergeMetaImageResults(lists);
}

export async function metaImageSearch(
  q: string,
  page: number,
  perPage: number,
  safe: boolean = true,
): Promise<SearchResponse> {
  const offset = (page - 1) * perPage;

  if (!safe) {
    const [bingSettled, braveSettled] = await Promise.allSettled([
      fetchBingImagesMergedParallel(q, page, perPage, safe),
      loadBraveImageTiles(q, page, perPage, safe),
    ]);
    const bingList = bingSettled.status === 'fulfilled' ? bingSettled.value : [];
    const braveList = braveSettled.status === 'fulfilled' ? braveSettled.value : [];
    const merged = mergeMetaImageResults([braveList, bingList]).slice(0, perPage);
    return {
      query: q,
      type: 'image',
      page,
      perPage,
      totalResults: merged.length === 0 ? 0 : Math.max(offset + merged.length, 50_000),
      results: merged,
    };
  }

  const merged = (await fetchBingImagesMergedParallel(q, page, perPage, safe)).slice(0, perPage);
  return {
    query: q,
    type: 'image',
    page,
    perPage,
    totalResults: merged.length === 0 ? 0 : Math.max(offset + merged.length, 50_000),
    results: merged,
  };
}

/** Domains that are search engines / social feeds — skip as video page URLs. */
const SKIP_VIDEO_HOSTS = new Set([
  'bing.com', 'google.com', 'duckduckgo.com', 'brave.com', 'yandex.com',
  'yandex.ru', 'twitter.com', 'x.com', 'facebook.com', 'instagram.com',
  'pinterest.com', 'linkedin.com', 'reddit.com', 'tumblr.com',
]);

function isUsableVideoPageUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    const tld = h.split('.').slice(-2).join('.');
    return !SKIP_VIDEO_HOSTS.has(h) && !SKIP_VIDEO_HOSTS.has(tld) && url.startsWith('http');
  } catch {
    return false;
  }
}

function parseBingVideos(html: string, limit: number): SearchResult[] {
  const $ = cheerio.load(html);
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  let i = 0;

  const pushVideo = (href: string, title: string | null, thumb: string | null, scoreBase = 130) => {
    if (out.length >= limit) return;
    if (!isUsableVideoPageUrl(href)) return;
    const key = normalizeUrlKey(href);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const vid: IndexedVideo = {
      id: id('metavid', href),
      url: href,
      pageUrl: href,
      title,
      description: null,
      thumbnailUrl: bestVideoThumbnail(href, thumb),
      duration: null,
      platform: platformLabelFromVideoUrl(href),
      crawledAt: new Date(),
    };
    out.push({ type: 'video', score: scoreBase - i * 0.4, data: vid });
    i++;
  };

  const resolveHref = (raw: string): string => {
    let h = raw.trim();
    if (h.startsWith('//')) h = `https:${h}`;
    if (h.startsWith('/url?') || h.startsWith('/search')) {
      try {
        const u = new URL(h, 'https://www.bing.com');
        const q = u.searchParams.get('q') ?? u.searchParams.get('url');
        if (q?.startsWith('http')) h = decodeURIComponent(q);
      } catch { /* ignore */ }
    }
    return decodeBingRedirect(h);
  };

  /** Bing video SERP tiles — extract any host, not just YouTube */
  $('a.mc_vtvc_link').each((_, el) => {
    if (out.length >= limit) return;
    const $a = $(el);
    const hrefAttr = $a.attr('href') ?? '';
    const parentHtml = $a.parent().html() ?? '';

    // Try platform-specific extraction first
    const watchUrl = resolveWatchUrlFromBingTile(hrefAttr, parentHtml);
    if (watchUrl) {
      const aria = $a.attr('aria-label') ?? '';
      const title = aria.replace(/ from (?:YouTube|Vimeo|Dailymotion|.+)$/i, '').trim() || null;
      const thumb = $a.find('img').first().attr('src') ?? $a.find('img').first().attr('data-src') ?? null;
      pushVideo(watchUrl, title, thumb);
      return;
    }

    // Fall back: grab any linked domain from the tile markup
    const tileText = `${hrefAttr} ${parentHtml}`;
    const urlMatch = tileText.match(/https?:\/\/[^\s"'<>]+/);
    if (urlMatch?.[0]) {
      const resolved = resolveHref(urlMatch[0]);
      const thumb = $a.find('img').first().attr('src') ?? null;
      pushVideo(resolved, $a.attr('aria-label')?.trim() || null, thumb);
    }
  });

  /** vidCard modules */
  $('div[data-module="vidCard"]').each((_, el) => {
    if (out.length >= limit) return;
    const $el = $(el);
    const a = $el.find('a[href^="http"], a[href^="//"]').first();
    let href = resolveHref(a.attr('href') ?? '');
    if (!href.startsWith('http')) return;
    const title = $el.find('.b_title, .vrhtitle, h2, h3').first().text().trim() || a.text().trim() || null;
    const thumb = $el.find('img').first().attr('data-src') ?? $el.find('img').first().attr('src') ?? null;
    pushVideo(href, title, thumb);
  });

  /** Fallback: general web algo results that mention video */
  $('li.b_algo').each((_, li) => {
    if (out.length >= limit) return;
    const $li = $(li);
    const text = $li.text().toLowerCase();
    if (!text.includes('video') && !text.includes('watch') && !text.includes('mp4')) return;
    const a = $li.find('h2 a').first();
    const href = resolveHref(a.attr('href') ?? '');
    if (!href.startsWith('http')) return;
    pushVideo(href, $li.find('h2').text().trim() || null, null, 90);
  });

  return out.slice(0, limit);
}

/** Parse Yandex Video SERP HTML — returns diverse non-YouTube hosting sites. */
function parseYandexVideos(html: string, limit: number): SearchResult[] {
  const $ = cheerio.load(html);
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  let i = 0;

  const push = (url: string, title: string | null, thumb: string | null, scoreBase = 145) => {
    if (out.length >= limit || !isUsableVideoPageUrl(url)) return;
    const key = normalizeUrlKey(url);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({
      type: 'video',
      score: scoreBase - i * 0.45,
      data: {
        id: id('yandex', url),
        url,
        pageUrl: url,
        title: title?.slice(0, 260) ?? null,
        description: null,
        thumbnailUrl: bestVideoThumbnail(url, thumb),
        duration: null,
        platform: platformLabelFromVideoUrl(url),
        crawledAt: new Date(),
      } satisfies IndexedVideo,
    });
    i++;
  };

  // Yandex embeds results as JSON in window.__DATA__ or window.Ya.define blocks
  const scriptText = $('script:not([src])').toArray().map((el) => $(el).html() ?? '').join('\n');

  // Try to extract video URLs from inline JSON blobs
  const urlRe = /"(?:url|src|videoUrl|playerUrl|embedUrl)":\s*"(https?:\/\/[^"]{8,500})"/g;
  const thumbRe = /"(?:thumb|thumbnail|poster|preview|previewUrl)":\s*"(https?:\/\/[^"]{8,400})"/g;
  const titleRe = /"(?:title|name)":\s*"([^"]{3,200})"/g;

  const scriptUrls: string[] = [];
  const scriptThumbs: string[] = [];
  const scriptTitles: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(scriptText)) !== null) scriptUrls.push(m[1]!);
  while ((m = thumbRe.exec(scriptText)) !== null) scriptThumbs.push(m[1]!);
  while ((m = titleRe.exec(scriptText)) !== null) scriptTitles.push(m[1]!);

  for (let j = 0; j < scriptUrls.length && out.length < limit; j++) {
    const u = scriptUrls[j]!;
    if (u.includes('yandex.') || u.includes('mc.yandex') || u.includes('favicon')) continue;
    push(u, scriptTitles[j] ?? null, scriptThumbs[j] ?? null);
  }

  // Fallback: HTML link extraction from video cards
  $('a[href^="http"], a[href^="//"]').each((_, el) => {
    if (out.length >= limit) return false;
    const $a = $(el);
    let href = $a.attr('href') ?? '';
    if (href.startsWith('//')) href = `https:${href}`;
    if (href.includes('yandex.') || href.includes('ya.ru')) return;
    const $card = $a.closest('[class*="item"], [class*="snippet"], article').first();
    if ($card.length === 0) return;
    const title = $card.find('[class*="title"], h2, h3').first().text().trim() || $a.text().trim() || null;
    const thumb = $card.find('img').first().attr('src') ?? $card.find('img').first().attr('data-src') ?? null;
    push(href, title, thumb, 120);
  });

  return out.slice(0, limit);
}

async function loadYandexVideos(q: string, page: number, safe: boolean): Promise<SearchResult[]> {
  const p = page - 1;
  // Yandex family filter: 'no' = off, 'moderate' = on
  const family = safe ? 'moderate' : 'no';
  const url = `https://yandex.com/video/search?text=${encodeURIComponent(q)}&p=${p}&family=${family}`;
  try {
    const html = await fetchHtml(url, {
      headers: {
        'Accept-Language': 'en-US,en;q=0.9,ru;q=0.7',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    return parseYandexVideos(html, 20);
  } catch {
    return [];
  }
}

/**
 * The main video-scraping pass: does a web search for the query, finds pages on
 * real video hosting sites (not YouTube/Vimeo/search engines), then immediately
 * fetches each page and extracts the direct MP4 URL from the HTML.
 */
async function loadScrapedVideoPages(q: string, safe: boolean): Promise<SearchResult[]> {
  // Fan out across multiple engines for maximum URL diversity
  const searches = await Promise.allSettled([
    (async () => {
      const body = new URLSearchParams({ q, b: '' });
      const html = await fetchHtml(ddgHtmlPath(safe), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      return parseDdgWeb(html);
    })(),
    (async () => {
      const safePart = safe ? '' : '&adlt=off&safesearch=off';
      const html = await fetchHtml(
        `https://www.bing.com/search?q=${encodeURIComponent(q)}&FORM=PERE${safePart}`,
      );
      return parseBingWeb(html);
    })(),
  ]);

  const allHits: RawHit[] = [];
  for (const s of searches) {
    if (s.status === 'fulfilled') allHits.push(...s.value);
  }

  // Deduplicate and filter to video-hosting pages only
  const VIDEO_HOST_RE = /video|watch|play|stream|clip|embed|tube|xxx|adult|porn|hentai|rule34|r34/i;
  const seen = new Set<string>();
  const candidates: RawHit[] = [];
  for (const h of allHits) {
    if (!isUsableVideoPageUrl(h.url)) continue;
    const host = new URL(h.url).hostname.replace(/^www\./, '');
    const isVideoHost =
      VIDEO_HOST_RE.test(host) ||
      VIDEO_HOST_RE.test(h.title) ||
      VIDEO_HOST_RE.test(h.description) ||
      /\/(video|watch|embed|play|clip)\//i.test(new URL(h.url).pathname);
    if (!isVideoHost) continue;
    const key = normalizeUrlKey(h.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push(h);
    if (candidates.length >= 14) break;
  }

  if (candidates.length === 0) return [];

  // Scrape each page in parallel for a direct video URL
  const deadline = Date.now() + 8_000;
  const results = await Promise.allSettled(
    candidates.map(async (h, idx): Promise<SearchResult | null> => {
      const remaining = deadline - Date.now();
      if (remaining < 500) return null;
      const scraped = await scrapePageForDirectVideo(h.url, Math.min(remaining, 3_500));
      if (!scraped) return null;
      const vid: IndexedVideo = {
        id: id('scraped', scraped.videoUrl),
        url: scraped.videoUrl,
        pageUrl: h.url,
        title: scraped.title ?? h.title ?? null,
        description: h.description || null,
        thumbnailUrl: scraped.thumbnailUrl ?? null,
        duration: null,
        platform: platformLabelFromVideoUrl(h.url),
        crawledAt: new Date(),
      };
      return { type: 'video', score: 200 - idx * 1.5, data: vid };
    }),
  );

  return results
    .map((r) => (r.status === 'fulfilled' ? r.value : null))
    .filter((r): r is SearchResult => r !== null);
}

export async function metaVideoSearch(
  q: string,
  page: number,
  perPage: number,
  safe: boolean = true,
): Promise<SearchResponse> {
  const first = 1 + (page - 1) * 12;
  const bingUrl = `https://www.bing.com/videos/search?q=${encodeURIComponent(q)}&first=${first}&FORM=QBLH${bingSafeQuery(safe)}`;
  const cap = Math.min(Math.max(perPage, 12), 28);

  // Run scraping pass and platform video search in parallel
  const [scrapedSettled, bingSettled, braveSettled, yandexSettled] = await Promise.allSettled([
    // Primary: web search → find video hosting pages → scrape MP4 URLs directly
    loadScrapedVideoPages(q, safe),
    // Secondary: platform video search endpoints (YouTube-heavy but useful as fallback)
    fetchHtml(bingUrl).then((html) => parseBingVideos(html, cap)),
    loadBraveVideoTiles(q, page, cap, safe),
    loadYandexVideos(q, page, safe),
  ]);

  const scrapedList = scrapedSettled.status === 'fulfilled' ? scrapedSettled.value : [];
  const bingList = bingSettled.status === 'fulfilled' ? bingSettled.value : [];
  const braveList = braveSettled.status === 'fulfilled' ? braveSettled.value : [];
  const yandexList = yandexSettled.status === 'fulfilled' ? yandexSettled.value : [];

  // Scraped results go first (highest score), platform results as supplement
  const platformMerged = mergeMetaVideoResults([braveList, yandexList, bingList]);
  // Enrich platform results that aren't already direct MP4s
  const enrichedPlatform = await enrichVideosWithDirectAssets(platformMerged.slice(0, perPage), 4_000);

  // Merge: scraped direct MP4s first, then enriched platform results
  const seenUrls = new Set<string>();
  const results: SearchResult[] = [];
  for (const r of [...scrapedList, ...enrichedPlatform]) {
    const u = (r.data as IndexedVideo).url;
    const k = normalizeUrlKey(u);
    if (!k || seenUrls.has(k)) continue;
    seenUrls.add(k);
    results.push(r);
    if (results.length >= perPage) break;
  }
  results.sort((a, b) => b.score - a.score);

  const offset = (page - 1) * perPage;
  return {
    query: q,
    type: 'video',
    page,
    perPage,
    totalResults: results.length === 0 ? 0 : Math.max(offset + results.length, 25_000),
    results,
  };
}

/** Scrape a page's HTML for .gif image URLs and return them as GIF results. */
async function scrapePageForGifs(pageUrl: string, limit: number, timeout = 3_500): Promise<SearchResult[]> {
  let html: string;
  try {
    const res = await fetch(pageUrl, {
      signal: AbortSignal.timeout(timeout),
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
    });
    if (!res.ok) return [];
    html = await res.text();
  } catch {
    return [];
  }

  const $ = cheerio.load(html);
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  let i = 0;

  const push = (gifUrl: string, alt: string | null) => {
    if (out.length >= limit) return;
    if (!gifUrl.startsWith('http')) return;
    if (!/\.gif(\?|$)/i.test(gifUrl) && !gifUrl.includes('image/gif')) return;
    // Skip tiny tracking pixels / icons
    const lower = gifUrl.toLowerCase();
    if (lower.includes('pixel') || lower.includes('tracking') || lower.includes('beacon')) return;
    const key = normalizeUrlKey(gifUrl);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({
      type: 'gif',
      score: 130 - i * 0.5,
      data: {
        id: id('scraped-gif', gifUrl),
        url: gifUrl,
        pageUrl,
        altText: alt,
        width: null,
        height: null,
        crawledAt: new Date(),
      },
    });
    i++;
  };

  // <img src="...gif"> and lazy variants
  $('img[src], img[data-src], img[data-lazy-src]').each((_, el) => {
    const $el = $(el);
    for (const attr of ['src', 'data-src', 'data-lazy-src', 'data-original']) {
      const v = $el.attr(attr) ?? '';
      if (/\.gif(\?|$)/i.test(v)) {
        push(v.startsWith('//') ? `https:${v}` : v, $el.attr('alt') ?? null);
      }
    }
  });

  // og:image pointing to a gif
  const og = $('meta[property="og:image"]').attr('content') ?? '';
  if (/\.gif(\?|$)/i.test(og)) push(og.startsWith('//') ? `https:${og}` : og, null);

  // Inline JSON blobs (common in React/Next image galleries)
  const scriptText = $('script:not([src])').toArray().map((el) => $(el).html() ?? '').join('\n');
  const gifRe = /"(https?:\/\/[^"]{8,400}\.gif(?:\?[^"]{0,200})?)"/g;
  let m: RegExpExecArray | null;
  while ((m = gifRe.exec(scriptText)) !== null && out.length < limit) {
    push(m[1]!, null);
  }

  return out.slice(0, limit);
}

/**
 * GIF search: web-search for "<query> gif" across engines, fan out to the result
 * pages, and scrape actual .gif image URLs from the HTML. No third-party API.
 */
export async function metaGifSearch(
  q: string,
  page: number,
  perPage: number,
  safe: boolean = true,
): Promise<SearchResponse> {
  // Collect candidate page URLs from multiple engines
  const searches = await Promise.allSettled([
    (async () => {
      const body = new URLSearchParams({ q: `${q} gif`, b: '' });
      return fetchHtml(ddgHtmlPath(safe), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      }).then(parseDdgWeb);
    })(),
    (async () => {
      const safePart = bingSafeQuery(safe);
      const first = 1 + (page - 1) * 10;
      return fetchHtml(
        `https://www.bing.com/search?q=${encodeURIComponent(`${q} gif`)}&first=${first}&FORM=PERE${safePart}`,
      ).then(parseBingWeb);
    })(),
  ]);

  // Collect unique page URLs that are likely to have GIFs
  const GIF_HOST_RE = /gif|react|gfycat|imgur|redgifs|e621|rule34|booru|gelbooru|safebooru|danbooru/i;
  const seenPages = new Set<string>();
  const candidates: string[] = [];

  for (const s of searches) {
    if (s.status !== 'fulfilled') continue;
    for (const h of s.value) {
      if (!h.url.startsWith('http')) continue;
      const host = (() => { try { return new URL(h.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
      const isGifPage =
        GIF_HOST_RE.test(host) ||
        /\.gif(\?|$)/i.test(h.url) ||
        GIF_HOST_RE.test(h.title) ||
        GIF_HOST_RE.test(h.description);
      if (!isGifPage) continue;
      const key = normalizeUrlKey(h.url);
      if (!key || seenPages.has(key)) continue;
      seenPages.add(key);
      candidates.push(h.url);
      if (candidates.length >= 16) break;
    }
  }

  // Fan out to scrape each candidate page for .gif URLs
  const deadline = Date.now() + 7_000;
  const scraped = await Promise.allSettled(
    candidates.map((url) => {
      const remaining = deadline - Date.now();
      if (remaining < 400) return Promise.resolve([] as SearchResult[]);
      return scrapePageForGifs(url, Math.ceil(perPage / 4) + 2, Math.min(remaining, 3_200));
    }),
  );

  // Merge, deduplicate, sort by score
  const seenGifs = new Set<string>();
  const results: SearchResult[] = [];
  for (const s of scraped) {
    if (s.status !== 'fulfilled') continue;
    for (const r of s.value) {
      const u = (r.data as { url: string }).url;
      const k = normalizeUrlKey(u);
      if (!k || seenGifs.has(k)) continue;
      seenGifs.add(k);
      results.push(r);
    }
  }
  results.sort((a, b) => b.score - a.score);

  const offset = (page - 1) * perPage;
  return {
    query: q,
    type: 'gif',
    page,
    perPage,
    totalResults: results.length === 0 ? 0 : Math.max(offset + results.length, 5_000),
    results: results.slice(0, perPage),
  };
}

export async function metaNewsSearch(
  q: string,
  page: number,
  perPage: number,
  safe: boolean = true,
): Promise<SearchResponse> {
  const first = 1 + (page - 1) * 10;
  const u = `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&first=${first}&FORM=HDRSC4${bingSafeQuery(safe)}`;
  const html = await fetchHtml(u);
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  let i = 0;
  $('a.title, .news-card a, a[href^="http"]').each((_, el) => {
    if (results.length >= perPage) return;
    const a = $(el);
    let href = a.attr('href')?.trim() ?? '';
    if (href.startsWith('//')) href = `https:${href}`;
    const decoded = decodeGoogleRedirect(href) ?? (href.startsWith('http') ? href : null);
    if (!decoded?.startsWith('http') || decoded.includes('bing.com')) return;
    const key = normalizeUrlKey(decoded);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const title = a.text().trim();
    if (title.length < 8) return;
    const row: IndexedPage = {
      id: id('metanews', decoded),
      url: decoded,
      title,
      description: a.closest('div').find('.snippet, .source').first().text().trim() || null,
      bodyText: null,
      wordCount: 0,
      rankScore: 100 - i,
      crawledAt: new Date(),
      language: null,
      headings: [],
      canonicalUrl: null,
    };
    results.push({ type: 'web', score: 110 - i * 0.5, data: row });
    i++;
  });
  return {
    query: q,
    type: 'news',
    page,
    perPage,
    totalResults: Math.max((page - 1) * perPage + results.length, 5_000),
    results: results.slice(0, perPage),
  };
}
