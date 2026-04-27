'use client';

import React, { useMemo, useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import axios from 'axios';
import FoxTailLogo from '@/components/FoxTailLogo';
import SearchBar from '@/components/SearchBar';
import Lightbox, { type MediaItem } from '@/components/Lightbox';
import DarkModeToggle from '@/components/DarkModeToggle';
import SafeSearchToggle from '@/components/SafeSearchToggle';
import SiteFavicon from '@/components/SiteFavicon';
import { apiUrl } from '@/lib/api';
import type { SearchResponse, SearchResult } from '@senko/shared';
import type { SearchTab } from '@/lib/history';
import { addHistory } from '@/lib/history';
import { useClientDark } from '@/lib/useClientDark';
import { usePrefs } from '@/lib/prefsContext';
import { prefetchUrl } from '@/lib/prefetch';
import { ExternalLink, Database, AlertCircle, ZoomIn, X, Globe, Maximize2, Minimize2 } from 'lucide-react';
import { displayUrlCompact, hostnameFromUrl, siteTitleFromHostname } from '@/lib/site';
import { embedPlayerUrl, isDirectVideoAssetUrl, videoPosterSrc, youtubeIdFromPageUrl, youtubePosterUrl } from '@/lib/videoEmbed';

const MAIN_TABS: { id: SearchTab; label: string }[] = [
  { id: 'web', label: 'Search' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Videos' },
];

/** Images tab loads this many stills + GIFs per infinite-scroll step (150 total). */
const GRID_IMAGES_PER_PAGE = 100;
const GRID_GIFS_PER_PAGE = 50;

type ImageGridInfiniteKey = readonly ['image-grid', string, string, number];

function parseTab(raw: string | null): SearchTab {
  if (raw === 'web' || raw === 'image' || raw === 'video') return raw;
  return 'web';
}

function interleaveImageAndGifResults(a: SearchResult[], b: SearchResult[]): SearchResult[] {
  const out: SearchResult[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (i < a.length) out.push(a[i]!);
    if (i < b.length) out.push(b[i]!);
  }
  return out;
}

type ImageHit = {
  id: string;
  url: string;
  pageUrl: string;
  altText: string | null;
  width: number | null;
  height: number | null;
  format: string | null;
};

/** Masonry tile: still images and GIFs share the same shape in the grid. */
type GridTileHit = ImageHit;

function gridTileFromResult(r: SearchResult): GridTileHit | null {
  if (r.type === 'image') return r.data as ImageHit;
  if (r.type === 'gif') {
    const g = r.data as {
      id: string;
      url: string;
      pageUrl: string;
      altText: string | null;
      width: number | null;
      height: number | null;
    };
    return { ...g, format: 'gif' };
  }
  return null;
}

function highlight(text: string | null | undefined, q: string): React.ReactNode {
  if (!text) return null;
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${esc})`, 'gi'));
  return parts.map((p, i) =>
    p.toLowerCase() === q.toLowerCase() ? (
      <span
        key={i}
        className="rounded px-0.5 font-medium text-inherit ring-1 ring-[var(--senko-orange)]/25 bg-[var(--senko-orange)]/15 dark:bg-[var(--senko-orange)]/20 dark:ring-[var(--senko-orange)]/30"
      >
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

type ImageMasonryCardProps = {
  img: GridTileHit;
  index: number;
  onOpenLightbox: (index: number) => void;
  onLoadFailed: (id: string) => void;
  query: string;
};

function ImageMasonryCardInner({ img, index, onOpenLightbox, onLoadFailed, query }: ImageMasonryCardProps) {
  const host = hostnameFromUrl(img.pageUrl);
  const siteLabel = siteTitleFromHostname(host);
  const dim =
    img.width && img.height ? `${img.width} x ${img.height}` : img.format ? String(img.format) : null;

  return (
    <article className="group/img mb-4 break-inside-avoid rounded-[14px] focus-within:ring-2 focus-within:ring-[var(--senko-orange)]/50 focus-within:ring-offset-2 focus-within:ring-offset-[#0b0e14] dark:focus-within:ring-offset-slate-950">
      <div className="relative overflow-hidden rounded-[14px] bg-[#141820] shadow-[0_6px_22px_rgba(0,0,0,0.22)] ring-1 ring-black/[0.06] transition-shadow duration-150 hover:shadow-[0_12px_32px_rgba(0,0,0,0.32)] hover:ring-white/10 dark:bg-[#0d1117] dark:ring-white/[0.08]">

        {/* Zoom / lightbox button — contains only the image, no interactive children */}
        <button
          type="button"
          className="relative block w-full cursor-zoom-in text-left outline-none"
          onClick={() => onOpenLightbox(index)}
          aria-label={img.altText ? `Open image: ${img.altText}` : 'Open image'}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- natural GIF/static aspect */}
          <img
            src={img.url}
            alt={img.altText ?? ''}
            className="h-auto w-full object-contain transition-transform duration-150 ease-out group-hover/img:scale-[1.02]"
            loading="lazy"
            decoding="async"
            onError={() => onLoadFailed(img.id)}
          />
        </button>

        {/* Hover overlay — sibling of the button so action buttons are never nested inside it */}
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent opacity-0 transition-opacity duration-150 group-hover/img:opacity-100"
          aria-hidden
        />

        {/* Zoom icon badge */}
        <div className="pointer-events-none absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white opacity-0 shadow-lg backdrop-blur-sm transition-opacity duration-150 group-hover/img:opacity-100">
          <ZoomIn className="h-4 w-4" aria-hidden />
        </div>

        {/* Info + action bar — absolutely positioned sibling, NOT inside the zoom button */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3 pt-10 opacity-0 transition-opacity duration-150 group-hover/img:pointer-events-auto group-hover/img:opacity-100">
          <p className="line-clamp-2 text-[13px] font-medium leading-snug text-white drop-shadow-md">
            {highlight(img.altText, query)}
          </p>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-white/85">
            <SiteFavicon hostname={host} size={16} />
            <span className="truncate">{siteLabel}</span>
            {dim ? <span className="shrink-0 text-white/50">· {dim}</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <a
              href={img.pageUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-white/15 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm transition hover:bg-white/25"
            >
              <ExternalLink className="h-3 w-3 opacity-90" />
              Source
            </a>
            <button
              type="button"
              className="rounded-md bg-white/15 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm transition hover:bg-white/25"
              onClick={() => void navigator.clipboard.writeText(img.url)}
            >
              Copy link
            </button>
          </div>
        </div>

      </div>
    </article>
  );
}

const ImageMasonryCard = React.memo(ImageMasonryCardInner);

type WebHitData = { id: string; url: string; title: string | null; description: string | null };

type VideoHitData = {
  id: string;
  url: string;
  pageUrl: string;
  title: string | null;
  thumbnailUrl: string | null;
  platform: string | null;
};

function VideoResultTile({
  v,
  onOpen,
}: {
  v: VideoHitData;
  onOpen: () => void;
}) {
  const host = hostnameFromUrl(v.pageUrl);
  const site = siteTitleFromHostname(host);
  const isDirect = isDirectVideoAssetUrl(v.url);
  const badge =
    v.platform?.trim() && v.platform.toLowerCase() !== 'web' ? v.platform.trim() : site;
  const initial = videoPosterSrc(v.thumbnailUrl, v.url);
  const [poster, setPoster] = useState<string | undefined>(initial);

  useEffect(() => {
    setPoster(videoPosterSrc(v.thumbnailUrl, v.url));
  }, [v.thumbnailUrl, v.url]);

  const onImgError = useCallback(() => {
    const yid = youtubeIdFromPageUrl(v.url);
    if (!yid) {
      setPoster(undefined);
      return;
    }
    if (poster?.includes('/hqdefault')) setPoster(youtubePosterUrl(yid, 'mq'));
    else if (poster?.includes('/mqdefault')) setPoster(youtubePosterUrl(yid, 'sd'));
    else setPoster(undefined);
  }, [poster, v.url]);

  const browseHref = `/browse?url=${encodeURIComponent(v.url)}`;

  return (
    <article className="group/vid relative overflow-hidden rounded-2xl border border-white/20 bg-white/[0.06] text-left shadow-[0_4px_24px_-6px_rgba(0,0,0,0.4)] backdrop-blur-2xl transition hover:border-white/[0.18] hover:bg-white/[0.09] dark:border-white/[0.09] dark:bg-white/[0.04] dark:hover:border-white/15 dark:hover:bg-white/[0.07]">
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5 dark:border-white/[0.06]">
          <SiteFavicon hostname={host} size={20} />
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {badge}
          </span>
          {isDirect && (
            <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
              MP4
            </span>
          )}
        </div>
        <div className="relative aspect-video w-full overflow-hidden bg-slate-950/90">
          {poster ? (
            // eslint-disable-next-line @next/next/no-img-element -- video poster URLs from many CDNs
            <img
              src={poster}
              alt=""
              className="h-full w-full object-cover transition duration-300 group-hover/vid:scale-[1.02]"
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={onImgError}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-b from-slate-800/80 to-slate-950 text-xs text-slate-500">
              No preview
            </div>
          )}
        </div>
      </button>
      <div className="flex items-start gap-2 border-t border-white/10 px-3 py-2.5 dark:border-white/[0.06]">
        <p className="min-w-0 flex-1 line-clamp-2 text-sm font-medium leading-snug text-slate-800 dark:text-slate-100">
          {v.title?.trim() || 'Untitled video'}
        </p>
        <Link
          href={browseHref}
          onMouseEnter={() => prefetchUrl(browseHref)}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-slate-600 transition hover:bg-white/10 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          aria-label="Open in theater / browse"
          title="Theater & full screen"
        >
          <Maximize2 className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </article>
  );
}

function WebResultCard({ p, q, safeParam }: { p: WebHitData; q: string; safeParam: string }) {
  const host = hostnameFromUrl(p.url);
  const siteLabel = siteTitleFromHostname(host);
  const snippet = p.description?.trim() ?? '';
  const urlShown = displayUrlCompact(p.url);
  return (
    <article className="group/result py-4 first:pt-1">
      {/* Site identity row */}
      <div className="mb-1 flex items-center gap-1.5">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-slate-200 dark:bg-white/[0.06] dark:ring-white/10">
          <SiteFavicon hostname={host} size={14} />
        </div>
        <span className="text-[13px] font-medium text-slate-700 dark:text-slate-300">{siteLabel}</span>
        <span className="text-slate-300 dark:text-white/20">›</span>
        <span className="truncate text-[12px] text-slate-400 dark:text-slate-500" title={p.url}>{urlShown}</span>
      </div>

      {/* Title */}
      <a
        href={p.url}
        target="_blank"
        rel="noreferrer"
        className="mb-1 block text-[18px] font-normal leading-snug text-blue-600 underline-offset-2 transition hover:underline dark:text-blue-400"
        onMouseEnter={() => prefetchUrl(`/search?q=${encodeURIComponent(q)}&type=web&page=1&safe=${safeParam}`)}
      >
        {p.title?.trim() ? highlight(p.title, q) : <span className="opacity-40">Untitled</span>}
      </a>

      {/* Snippet */}
      <p className={`text-[13.5px] leading-[1.6] line-clamp-2 ${snippet ? 'text-slate-600 dark:text-slate-400' : 'italic text-slate-400 dark:text-slate-500'}`}>
        {snippet ? highlight(snippet, q) : 'No description available.'}
      </p>

      {/* Action row — appears on hover */}
      <div className="mt-1.5 flex items-center gap-3 opacity-0 transition-opacity group-hover/result:opacity-100">
        <Link
          href={`/browse?url=${encodeURIComponent(p.url)}`}
          onMouseEnter={() => prefetchUrl(`/browse?url=${encodeURIComponent(p.url)}`)}
          className="inline-flex items-center gap-1 text-[12px] text-slate-400 transition hover:text-[var(--senko-orange)] dark:hover:text-[var(--senko-orange)]"
        >
          <Globe className="h-3 w-3" aria-hidden />
          Browse
        </Link>
        <Link
          href={`/browse?url=${encodeURIComponent(p.url)}&mode=proxy`}
          className="text-[12px] text-slate-400 transition hover:text-[var(--senko-orange)] dark:hover:text-[var(--senko-orange)]"
        >
          Proxy
        </Link>
      </div>
    </article>
  );
}

export default function SearchPageContent() {
  const params = useSearchParams();
  const router = useRouter();
  const clientDark = useClientDark();
  const q = params.get('q') ?? '';
  const type = parseTab(params.get('type'));
  const page = Number(params.get('page') ?? '1') || 1;

  useLayoutEffect(() => {
    const raw = params.get('type');
    if (raw === 'all' || raw === 'news' || raw === 'maps') {
      const sp = new URLSearchParams(params.toString());
      sp.set('type', 'web');
      router.replace(`/search?${sp.toString()}`, { scroll: false });
    } else if (raw === 'gif') {
      const sp = new URLSearchParams(params.toString());
      sp.set('type', 'image');
      router.replace(`/search?${sp.toString()}`, { scroll: false });
    }
  }, [params, router]);

  const [lightbox, setLightbox] = useState<{ items: MediaItem[]; index: number } | null>(null);
  const [videoModal, setVideoModal] = useState<string | null>(null);
  const videoStageRef = useRef<HTMLDivElement>(null);
  const [videoStageFs, setVideoStageFs] = useState(false);
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(() => new Set());
  const { safeSearch, setSafeSearch, setActiveTab, prefsReady } = usePrefs();

  const safeQs = params.get('safe');
  const safeForApi =
    safeQs === '0' || safeQs === 'false'
      ? false
      : safeQs === '1' || safeQs === 'true'
        ? true
        : safeSearch;
  const safeParam = safeForApi ? '1' : '0';

  useLayoutEffect(() => {
    if (safeQs === '0' || safeQs === 'false') {
      if (safeSearch !== false) setSafeSearch(false);
    } else if (safeQs === '1' || safeQs === 'true') {
      if (safeSearch !== true) setSafeSearch(true);
    }
  }, [safeQs, safeSearch, setSafeSearch]);

  const onSafeChange = useCallback(
    (next: boolean) => {
      setSafeSearch(next);
      const sp = new URLSearchParams();
      if (q) sp.set('q', q);
      sp.set('type', type);
      sp.set('page', String(page));
      sp.set('safe', next ? '1' : '0');
      router.replace(`/search?${sp.toString()}`, { scroll: false });
    },
    [q, type, page, setSafeSearch, router],
  );

  const apiSearchType: 'web' | 'image' | 'video' =
    type === 'image' ? 'image' : type === 'video' ? 'video' : 'web';

  const perPage = 20;

  const MAX_IMAGE_INFINITE_PAGES = 24;

  const awaitingPrefs = !prefsReady && Boolean(q && apiSearchType);

  const fetcher = async (url: string): Promise<SearchResponse> => {
    const res = await axios.get<SearchResponse>(url);
    return res.data;
  };

  const fetchImageGridPage = useCallback(
    async (key: ImageGridInfiniteKey): Promise<SearchResponse> => {
      const [, query, safe, pageIndex] = key;
      const page = pageIndex + 1;
      const enc = encodeURIComponent(query);
      const imgUrl = apiUrl(
        `/api/search?q=${enc}&type=image&page=${page}&perPage=${GRID_IMAGES_PER_PAGE}&safe=${safe}`,
      );
      const gifUrl = apiUrl(
        `/api/search?q=${enc}&type=gif&page=${page}&perPage=${GRID_GIFS_PER_PAGE}&safe=${safe}`,
      );
      const [imgRes, gifRes] = await Promise.all([
        axios.get<SearchResponse>(imgUrl),
        axios.get<SearchResponse>(gifUrl),
      ]);
      const imgList = imgRes.data.results ?? [];
      const gifList = gifRes.data.results ?? [];
      const merged = interleaveImageAndGifResults(imgList, gifList);
      return {
        query,
        type: 'image',
        page,
        perPage: GRID_IMAGES_PER_PAGE + GRID_GIFS_PER_PAGE,
        totalResults: (imgRes.data.totalResults ?? 0) + (gifRes.data.totalResults ?? 0),
        results: merged,
      };
    },
    [],
  );

  const imageInfiniteKey = useCallback(
    (pageIndex: number, previousPageData: SearchResponse | null): ImageGridInfiniteKey | null => {
      if (type !== 'image' || !prefsReady || !q) return null;
      if (pageIndex >= MAX_IMAGE_INFINITE_PAGES) return null;
      if (previousPageData != null && previousPageData.results.length === 0) return null;
      return ['image-grid', q, safeParam, pageIndex] as const;
    },
    [type, prefsReady, q, safeParam],
  );

  const {
    data: imagePages,
    size: imageSize,
    setSize: setImageSize,
    isLoading: imageIsLoading,
    isValidating: imageIsValidating,
    error: imageError,
  } = useSWRInfinite<SearchResponse, Error>(imageInfiniteKey, (k) => fetchImageGridPage(k as ImageGridInfiniteKey), {
    shouldRetryOnError: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 0,
    revalidateFirstPage: false,
    parallel: true,
  });

  const singleKey =
    prefsReady && q && apiSearchType && type !== 'image'
      ? apiUrl(
          `/api/search?q=${encodeURIComponent(q)}&type=${apiSearchType}&page=${page}&perPage=${perPage}&safe=${safeParam}`,
        )
      : null;

  const { data: singleData, isLoading: singleIsLoading, isValidating: singleIsValidating, error: singleError } = useSWR(
    singleKey,
    fetcher,
    {
      shouldRetryOnError: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 60000,
      fallbackData: undefined,
    },
  );

  const mergedImageData = useMemo((): SearchResponse | undefined => {
    if (type !== 'image' || !imagePages?.length) return undefined;
    const seen = new Set<string>();
    const results: SearchResult[] = [];
    for (const p of imagePages) {
      if (!p?.results) continue;
      for (const r of p.results) {
        if (r.type !== 'image' && r.type !== 'gif') continue;
        const id = (r.data as { id: string }).id;
        if (seen.has(id)) continue;
        seen.add(id);
        results.push(r);
      }
    }
    const first = imagePages[0];
    return {
      query: q,
      type: 'image',
      page: 1,
      perPage: GRID_IMAGES_PER_PAGE + GRID_GIFS_PER_PAGE,
      totalResults: first?.totalResults ?? 0,
      results,
    };
  }, [type, imagePages, q]);

  const data = type === 'image' ? mergedImageData : singleData;
  const isLoading = type === 'image' ? imageIsLoading : singleIsLoading;
  const isValidating = type === 'image' ? imageIsValidating : singleIsValidating;
  const error = type === 'image' ? imageError : singleError;

  const imageLastPage = imagePages && imagePages.length > 0 ? imagePages[imagePages.length - 1] : undefined;
  const imageReachedEnd =
    type === 'image' &&
    (imageSize >= MAX_IMAGE_INFINITE_PAGES ||
      (imageLastPage != null && imageLastPage.results.length === 0));
  const loadMoreImages = useCallback(() => {
    if (type !== 'image' || imageReachedEnd) return;
    void setImageSize((n) => n + 1);
  }, [type, imageReachedEnd, setImageSize]);

  const loadMoreImagesRef = useRef(loadMoreImages);
  loadMoreImagesRef.current = loadMoreImages;

  const imageSentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (type !== 'image') return;
    const node = imageSentinelRef.current;
    if (!node) return;
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMoreImagesRef.current();
      },
      { root: null, rootMargin: '1800px', threshold: 0 },
    );
    ob.observe(node);
    return () => ob.disconnect();
  }, [type, q, safeParam, imageSize]);

  const errorMessage = axios.isAxiosError(error)
    ? (error.response?.data as { error?: string } | undefined)?.error ??
      error.message
    : error instanceof Error
      ? error.message
      : null;

  useEffect(() => {
    if (q) addHistory(q, type);
  }, [q, type]);

  useEffect(() => {
    setFailedImageIds(new Set());
  }, [q, page, type, safeForApi]);

  const onSubmit = (query: string, tab: SearchTab) => {
    setActiveTab(tab);
    router.push(
      `/search?q=${encodeURIComponent(query)}&type=${tab}&page=1&safe=${safeForApi ? '1' : '0'}`,
    );
  };

  const visibleImageResults = useMemo(() => {
    if (!data?.results || type !== 'image') return [];
    return data.results
      .map((r) => {
        const hit = gridTileFromResult(r);
        return hit && !failedImageIds.has(hit.id) ? { r, hit } : null;
      })
      .filter((x): x is { r: SearchResult; hit: GridTileHit } => x != null);
  }, [data, type, failedImageIds]);

  const onImageLoadFailed = useCallback((id: string) => {
    setFailedImageIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const imageTabMediaItems: MediaItem[] = useMemo(
    () =>
      visibleImageResults.map(({ hit }) => ({
        url: hit.url,
        pageUrl: hit.pageUrl,
        alt: hit.altText ?? null,
        title: null,
      })),
    [visibleImageResults],
  );

  const openLightboxAt = useCallback(
    (i: number) => {
      setLightbox({ items: imageTabMediaItems, index: i });
    },
    [imageTabMediaItems],
  );

  const resultsLoading =
    awaitingPrefs ||
    (type === 'image' ? imageIsLoading && !imagePages : Boolean(singleKey) && singleIsLoading);
  const resultsBusy =
    awaitingPrefs ||
    (type === 'image'
      ? imageIsLoading || imageIsValidating
      : Boolean(singleKey) && (singleIsLoading || singleIsValidating));

  const videoEmbedSrc = videoModal
    ? embedPlayerUrl(videoModal, { autoplay: true, allowInlineFullscreen: true })
    : null;

  useEffect(() => {
    const onFs = () => setVideoStageFs(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    if (!videoModal && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
      setVideoStageFs(false);
    }
  }, [videoModal]);

  const toggleVideoStageFullscreen = useCallback(async () => {
    const el = videoStageRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) await el.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-[#0f1117] dark:text-slate-100">
      {/* Header — clean white/dark bar, no glass blur */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white dark:border-white/[0.08] dark:bg-[#0f1117]">
        <div className="mx-auto flex max-w-[1200px] items-center gap-3 px-4 py-2.5 sm:gap-5 sm:px-6">
          {/* Logo */}
          <button type="button" className="flex shrink-0 items-center gap-2 mr-1" onClick={() => router.push('/')}>
            <FoxTailLogo size={28} animated={false} glowing={clientDark} />
            <span className="hidden font-display text-[18px] font-bold tracking-tight text-slate-900 dark:text-white sm:block">Senko</span>
          </button>

          {/* Search bar */}
          <div className="min-w-0 flex-1 max-w-[620px]">
            <SearchBar initialQuery={q} compact onSubmitSearch={onSubmit} activeTab={type} />
          </div>

          {/* Controls */}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <SafeSearchToggle safe={safeSearch} onChange={onSafeChange} compact />
            <DarkModeToggle />
          </div>
        </div>

        {/* Tab row */}
        <div className="mx-auto flex max-w-[1200px] items-center gap-0.5 border-t border-slate-100 px-4 dark:border-white/[0.05] sm:px-6">
          {MAIN_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`relative shrink-0 px-4 py-2.5 text-[13px] font-medium transition-colors ${
                type === t.id
                  ? 'text-[var(--senko-orange)] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:rounded-t-full after:bg-[var(--senko-orange)]'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
              onClick={() => {
                setActiveTab(t.id);
                router.push(`/search?q=${encodeURIComponent(q)}&type=${t.id}&page=1&safe=${safeParam}`);
              }}
              onMouseEnter={() => prefetchUrl(`/search?q=${encodeURIComponent(q)}&type=${t.id}&page=1&safe=${safeParam}`)}
            >
              {t.label}
            </button>
          ))}
          <span className="ml-auto shrink-0 text-[12px] tabular-nums text-slate-400 dark:text-slate-500">
            {type === 'image' && visibleImageResults.length > 0 ? `${visibleImageResults.length} shown · ` : ''}
            {(data?.totalResults ?? 0).toLocaleString()} results
          </span>
        </div>

        {resultsBusy && (
          <div className="h-[2px] w-full overflow-hidden bg-orange-500/15" aria-hidden>
            <div className="senko-route-progress h-full w-1/3 bg-[var(--senko-orange)]" />
          </div>
        )}
      </header>

      <main
        className={`mx-auto px-4 sm:px-6 ${type === 'image' ? 'max-w-[min(100vw,88rem)] py-4 md:py-6' : 'max-w-[1200px] py-5'}`}
      >
        {resultsLoading && type === 'image' && (
          <div className="columns-2 gap-x-2 sm:gap-x-3 md:columns-5">
            {[58, 42, 72, 50, 65, 48, 80, 55, 62, 45].map((h, i) => (
              <div
                key={i}
                className="mb-4 break-inside-avoid rounded-[14px] bg-gradient-to-b from-white/15 to-white/5 dark:from-white/[0.07] dark:to-white/[0.02]"
                style={{ height: `${h * 4}px` }}
              />
            ))}
          </div>
        )}

        {resultsLoading && type !== 'image' && (
          <div className="max-w-[660px] divide-y divide-slate-100 dark:divide-white/[0.05]">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="py-4">
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="h-5 w-5 animate-pulse rounded-full bg-slate-200 dark:bg-white/10" />
                  <span className="h-3 w-24 animate-pulse rounded bg-slate-200 dark:bg-white/10" />
                  <span className="h-3 w-40 animate-pulse rounded bg-slate-100 dark:bg-white/[0.06]" />
                </div>
                <span className="mb-1 block h-[18px] w-3/4 animate-pulse rounded bg-slate-200 dark:bg-white/10" />
                <span className="block h-3.5 w-full animate-pulse rounded bg-slate-100 dark:bg-white/[0.06]" />
                <span className="mt-1 block h-3.5 w-5/6 animate-pulse rounded bg-slate-100 dark:bg-white/[0.06]" />
              </div>
            ))}
          </div>
        )}

        {!resultsLoading && error && (
          <div className="glass-strong mx-auto max-w-3xl overflow-hidden">
            <div className="border-b border-white/30 bg-gradient-to-r from-orange-500/10 via-amber-500/10 to-transparent px-6 py-4 dark:border-white/[0.06]">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-200/60 bg-white/70 text-[var(--senko-orange)] shadow-sm dark:border-orange-500/20 dark:bg-white/5">
                  <AlertCircle className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
                    Search is not ready yet
                  </h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    The frontend is up, but the API could not complete this search.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 px-6 py-6 md:grid-cols-2">
              <div className="rounded-2xl border border-white/50 bg-white/45 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/35">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                  <Database className="h-4 w-4 text-[var(--senko-orange)]" />
                  Likely local issue
                </div>
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  Postgres is probably not running on <code>localhost:5432</code>, so the API cannot read search
                  results yet.
                </p>
              </div>

              <div className="rounded-2xl border border-white/50 bg-white/45 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/35">
                <div className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Start local services
                </div>
                <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                  <code className="block rounded-xl bg-slate-900 px-3 py-2 text-slate-100">docker compose up -d postgres redis</code>
                  <code className="block rounded-xl bg-slate-900 px-3 py-2 text-slate-100">npm run db:migrate</code>
                </div>
              </div>
            </div>

            {errorMessage && (
              <div className="border-t border-white/20 px-6 py-4 text-sm text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
                <span className="font-medium text-slate-700 dark:text-slate-200">API message:</span>{' '}
                {errorMessage}
              </div>
            )}
          </div>
        )}

        {!resultsLoading && data && data.totalResults === 0 && (
          <div className="flex flex-col items-center py-20 text-center">
            <FoxTailLogo size={80} animated glowing />
            <p className="mt-4 text-lg">No results found for &quot;{q}&quot;</p>
            {safeForApi && (type === 'image' || type === 'video') && (
              <p className="mt-3 max-w-md text-sm text-slate-600 dark:text-slate-400">
                With safe search on, image and video results may be limited for some queries. Try{' '}
                <button
                  type="button"
                  className="font-medium text-[var(--senko-orange)] underline decoration-dotted underline-offset-2 hover:opacity-90"
                  onClick={() =>
                    router.push(`/search?q=${encodeURIComponent(q)}&type=web&page=1&safe=${safeParam}`)
                  }
                >
                  Web results
                </button>{' '}
                for text links, or turn off safe search.
              </p>
            )}
          </div>
        )}

        {!resultsLoading && !error && data && type === 'web' && (
          <div className="max-w-[660px] divide-y divide-slate-100 dark:divide-white/[0.05]">
            {data.results.map((r) => {
              const p = r.data as WebHitData;
              return <WebResultCard key={p.id} p={p} q={q} safeParam={safeParam} />;
            })}
          </div>
        )}

        {!resultsLoading && !error && data && type === 'image' && (
          <>
            {visibleImageResults.length === 0 && data.results.length > 0 ? (
              <p className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
                No image previews could be loaded for this page.
              </p>
            ) : (
              <>
                <div className="columns-2 gap-x-2 sm:gap-x-3 md:columns-5">
                  {visibleImageResults.map(({ hit }, idx) => (
                    <ImageMasonryCard
                      key={hit.id}
                      img={hit}
                      index={idx}
                      query={q}
                      onLoadFailed={onImageLoadFailed}
                      onOpenLightbox={openLightboxAt}
                    />
                  ))}
                </div>
                <div ref={imageSentinelRef} className="h-4 w-full" aria-hidden />
                {imageIsValidating && !imageReachedEnd ? (
                  <p className="pb-8 pt-4 text-center text-sm text-slate-500 dark:text-slate-400">
                    Loading more images…
                  </p>
                ) : null}
                {imageReachedEnd && visibleImageResults.length > 0 ? (
                  <p className="pb-8 pt-2 text-center text-xs text-slate-400 dark:text-slate-500">
                    {imageSize >= MAX_IMAGE_INFINITE_PAGES
                      ? 'Showing the maximum number of loaded image pages'
                      : 'End of image results'}
                  </p>
                ) : null}
              </>
            )}
          </>
        )}

        {!resultsLoading && !error && data && type === 'video' && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {data.results.map((r) => {
              const v = r.data as VideoHitData;
              return <VideoResultTile key={v.id} v={v} onOpen={() => setVideoModal(v.url)} />;
            })}
          </div>
        )}

        {type !== 'image' && !error && data && data.totalResults > 0 && (
          <div className={`mt-10 flex justify-start gap-3 ${type === 'web' ? 'max-w-[660px]' : ''}`}>
            <button
              type="button"
              className="rounded-full border border-slate-300/80 bg-white px-6 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:bg-white/[0.06] dark:text-slate-200 dark:hover:bg-white/[0.1] dark:disabled:hover:bg-white/[0.06]"
              disabled={page <= 1}
              onClick={() =>
                router.push(
                  `/search?q=${encodeURIComponent(q)}&type=${type}&page=${page - 1}&safe=${safeParam}`,
                )
              }
            >
              ← Previous
            </button>
            <button
              type="button"
              className="rounded-full border border-slate-300/80 bg-white px-6 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:bg-white/[0.06] dark:text-slate-200 dark:hover:bg-white/[0.1] dark:disabled:hover:bg-white/[0.06]"
              disabled={page * (data.perPage ?? 10) >= data.totalResults}
              onClick={() =>
                router.push(
                  `/search?q=${encodeURIComponent(q)}&type=${type}&page=${page + 1}&safe=${safeParam}`,
                )
              }
            >
              Next →
            </button>
          </div>
        )}
      </main>

      {lightbox && (
        <Lightbox items={lightbox.items} initialIndex={lightbox.index} onClose={() => setLightbox(null)} />
      )}

      {videoModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-md"
          onClick={() => setVideoModal(null)}
          role="presentation"
        >
          <div
            ref={videoStageRef}
            className="relative w-full max-w-5xl overflow-hidden rounded-2xl border border-white/15 bg-slate-950/85 shadow-[0_24px_80px_-20px_rgba(0,0,0,0.85)] outline-none [&:fullscreen]:max-w-none [&:fullscreen]:h-full [&:fullscreen]:rounded-none"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal
            aria-label="Video player"
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <span className="truncate text-sm font-medium text-slate-200">Video</span>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white"
                  aria-label={videoStageFs ? 'Exit full screen' : 'Full screen'}
                  onClick={() => void toggleVideoStageFullscreen()}
                >
                  {videoStageFs ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white"
                  aria-label="Close"
                  onClick={() => setVideoModal(null)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="aspect-video w-full bg-black">
              {videoModal && isDirectVideoAssetUrl(videoModal) ? (
                // Direct MP4/WebM — use native <video> so no iframe CORS issues
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video
                  key={videoModal}
                  src={videoModal}
                  className="h-full w-full"
                  controls
                  autoPlay
                  playsInline
                />
              ) : videoEmbedSrc ? (
                <iframe
                  src={videoEmbedSrc}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share"
                  allowFullScreen
                  title="Video player"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
                  <p className="max-w-sm text-sm text-slate-400">
                    This video can&apos;t be embedded. Open it in a new tab to watch.
                  </p>
                  <a
                    href={videoModal}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm font-medium text-white ring-1 ring-white/15 transition hover:bg-white/15"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open video
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
