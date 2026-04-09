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
  $('a[href*="youtube.com/watch"], a[href*="youtu.be/"], a[href*="vimeo.com/"]').each((_, el) => {
    if (out.length >= limit) return false;
    const $a = $(el);
    let href = $a.attr('href') ?? '';
    if (href.startsWith('/url?q=') || href.startsWith('/search')) {
      try {
        const u = new URL(href, 'https://search.brave.com');
        const qv = u.searchParams.get('q') ?? u.searchParams.get('url');
        if (qv?.startsWith('http')) href = decodeURIComponent(qv);
      } catch {
        /* ignore */
      }
    }
    if (href.startsWith('//')) href = `https:${href}`;
    if (!href.startsWith('http')) return;
    const key = normalizeUrlKey(href);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const $scope = $a.closest('article, [class*="snippet"], [class*="fdl"]').first();
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

function parseBingVideos(html: string, limit: number): SearchResult[] {
  const $ = cheerio.load(html);
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  let i = 0;

  const pushVideo = (href: string, title: string | null, thumb: string | null) => {
    if (out.length >= limit) return;
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
    out.push({ type: 'video', score: 130 - i * 0.4, data: vid });
    i++;
  };

  /** Bing video SERP: `a.mc_vtvc_link` tiles (YouTube-heavy, sometimes other hosts in markup). */
  $('a.mc_vtvc_link').each((_, el) => {
    if (out.length >= limit) return;
    const $a = $(el);
    const hrefAttr = $a.attr('href') ?? '';
    const parentHtml = $a.parent().html() ?? '';
    const watchUrl = resolveWatchUrlFromBingTile(hrefAttr, parentHtml);
    if (!watchUrl) return;
    const aria = $a.attr('aria-label') ?? '';
    const title = aria.includes(' from YouTube')
      ? aria.split(' from YouTube')[0]!.trim()
      : aria.includes(' from Vimeo')
        ? aria.split(' from Vimeo')[0]!.trim()
        : aria.trim() || null;
    const thumbRaw =
      $a.find('img').first().attr('src') ??
      $a.find('img').first().attr('data-src') ??
      $a.find('img').first().attr('data-src-hq') ??
      null;
    pushVideo(watchUrl, title || null, thumbRaw);
  });

  $('div[data-module="vidCard"]').each((_, el) => {
    if (out.length >= limit) return;
    const $el = $(el);
    const a = $el
      .find(
        'a[href*="youtube.com"], a[href*="youtu.be"], a[href*="vimeo.com"], a[href*="dailymotion.com"]',
      )
      .first();
    let href = a.attr('href') ?? '';
    if (href.startsWith('//')) href = `https:${href}`;
    if (!href.startsWith('http')) return;
    const title = $el.find('.b_title, .vrhtitle').first().text().trim() || a.text().trim();
    const thumb =
      $el.find('img').first().attr('data-src') ??
      $el.find('img').first().attr('src') ??
      $el.find('img').first().attr('data-src-hq') ??
      null;
    pushVideo(href, title || null, thumb);
  });
  if (out.length < 3) {
    $('li.b_algo').each((_, li) => {
      if (out.length >= limit) return;
      const $li = $(li);
      const a = $li
        .find('a[href*="youtube"], a[href*="youtu.be"], a[href*="vimeo"], a[href*="dailymotion"]')
        .first();
      const href = a.attr('href')?.replace(/^\/\//, 'https://') ?? '';
      if (!href.startsWith('http')) return;
      pushVideo(href, $li.find('h2').text().trim() || null, null);
    });
  }
  return out.slice(0, limit);
}

export async function metaVideoSearch(
  q: string,
  page: number,
  perPage: number,
  safe: boolean = true,
): Promise<SearchResponse> {
  const first = 1 + (page - 1) * 12;
  const bingUrl = `https://www.bing.com/videos/search?q=${encodeURIComponent(q)}&first=${first}&FORM=QBLH${bingSafeQuery(safe)}`;
  const cap = Math.min(Math.max(perPage, 12), 24);
  const [bingSettled, braveSettled] = await Promise.allSettled([
    fetchHtml(bingUrl).then((html) => parseBingVideos(html, cap)),
    loadBraveVideoTiles(q, page, cap, safe),
  ]);
  const bingList = bingSettled.status === 'fulfilled' ? bingSettled.value : [];
  const braveList = braveSettled.status === 'fulfilled' ? braveSettled.value : [];
  const results = mergeMetaVideoResults([braveList, bingList]).slice(0, perPage);
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
