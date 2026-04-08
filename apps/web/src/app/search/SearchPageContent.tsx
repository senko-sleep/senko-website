'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import axios from 'axios';
import { motion } from 'framer-motion';
import FoxTailLogo from '@/components/FoxTailLogo';
import SearchBar from '@/components/SearchBar';
import Lightbox, { type MediaItem } from '@/components/Lightbox';
import DarkModeToggle from '@/components/DarkModeToggle';
import SafeSearchToggle, { useSafeSearch } from '@/components/SafeSearchToggle';
import SiteFavicon from '@/components/SiteFavicon';
import ImageSuggestionsPanel from '@/components/ImageSuggestionsPanel';
import { apiUrl } from '@/lib/api';
import type { SearchResponse } from '@senko/shared';
import type { SearchTab } from '@/lib/history';
import { addHistory } from '@/lib/history';
import { useClientDark } from '@/lib/useClientDark';
import { Play, MapPin, ExternalLink } from 'lucide-react';
import Image from 'next/image';
import { hostnameFromUrl, siteTitleFromHostname } from '@/lib/site';

const MAIN_TABS: { id: SearchTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'web', label: 'Search' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Videos' },
  { id: 'maps', label: 'Maps' },
  { id: 'news', label: 'News' },
];

function parseTab(raw: string | null): SearchTab {
  const allowed: SearchTab[] = ['all', 'web', 'image', 'video', 'gif', 'news', 'maps'];
  if (raw && allowed.includes(raw as SearchTab)) return raw as SearchTab;
  return 'all';
}

function highlight(text: string | null | undefined, q: string): React.ReactNode {
  if (!text) return null;
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${esc})`, 'gi'));
  return parts.map((p, i) =>
    p.toLowerCase() === q.toLowerCase() ? (
      <mark key={i} className="bg-[var(--senko-orange)]/30">
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

export default function SearchPageContent() {
  const params = useSearchParams();
  const router = useRouter();
  const clientDark = useClientDark();
  const q = params.get('q') ?? '';
  const type = parseTab(params.get('type'));
  const page = Number(params.get('page') ?? '1') || 1;

  const [lightbox, setLightbox] = useState<{ items: MediaItem[]; index: number } | null>(null);
  const [videoModal, setVideoModal] = useState<string | null>(null);
  const [safe, setSafe] = useSafeSearch();

  const safeParam = safe ? '1' : '0';

  const apiSearchType =
    type === 'maps'
      ? null
      : type === 'all'
        ? 'all'
        : type === 'news'
          ? 'news'
          : type === 'gif'
            ? 'gif'
            : type;

  const key =
    q && apiSearchType
      ? apiUrl(
          `/api/search?q=${encodeURIComponent(q)}&type=${apiSearchType}&page=${page}&safe=${safeParam}`,
        )
      : null;

  const fetcher = async (url: string): Promise<SearchResponse> => {
    try {
      const res = await axios.get<SearchResponse>(url);
      return res.data;
    } catch {
      return {
        query: q,
        type: String(apiSearchType ?? 'web'),
        page,
        perPage: 10,
        totalResults: 0,
        results: [],
      };
    }
  };

  const { data, isLoading } = useSWR(key, fetcher, { shouldRetryOnError: false });

  useEffect(() => {
    if (q) addHistory(q, type);
  }, [q, type]);

  const onSubmit = (query: string, tab: SearchTab) => {
    router.push(`/search?q=${encodeURIComponent(query)}&type=${tab}&page=1`);
  };

  const mediaItems: MediaItem[] = useMemo(() => {
    if (!data?.results) return [];
    return data.results
      .filter((r) => r.type === 'image' || r.type === 'gif')
      .map((r) => {
        const d = r.data as { url: string; pageUrl: string; altText?: string | null; title?: string | null };
        return {
          url: d.url,
          pageUrl: d.pageUrl,
          alt: d.altText ?? null,
          title: d.title ?? null,
        };
      });
  }, [data]);

  const showWeb =
    type === 'web' || type === 'news' || type === 'all';

  const mapsLinks = useMemo(() => {
    const enc = encodeURIComponent(q);
    return {
      google: `https://www.google.com/maps/search/?api=1&query=${enc}`,
      osm: `https://www.openstreetmap.org/search?query=${enc}`,
      bing: `https://www.bing.com/maps?q=${enc}`,
    };
  }, [q]);

  return (
    <div className="min-h-screen text-slate-900 dark:text-slate-100">
      <header className="sticky top-0 z-30 border-b border-white/30 bg-white/45 shadow-sm backdrop-blur-2xl dark:border-white/[0.06] dark:bg-slate-950/50">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3.5">
          <button type="button" className="flex shrink-0 items-center gap-2" onClick={() => router.push('/')}>
            <FoxTailLogo size={32} animated={false} glowing={clientDark} />
            <span className="font-display text-xl font-bold tracking-tight text-slate-900 dark:text-white">Senko</span>
          </button>
          <div className="min-w-0 flex-1">
            <SearchBar initialQuery={q} compact onSubmitSearch={onSubmit} activeTab={type} />
          </div>
          <SafeSearchToggle safe={safe} onChange={setSafe} />
          <DarkModeToggle />
        </div>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-1 gap-y-2 border-t border-white/20 px-4 pb-3 pt-2 dark:border-white/[0.04]">
          {MAIN_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                type === t.id
                  ? 'bg-white/70 font-semibold text-slate-900 shadow-sm dark:bg-white/10 dark:text-white'
                  : 'text-slate-500 hover:bg-white/40 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-200'
              }`}
              onClick={() => router.push(`/search?q=${encodeURIComponent(q)}&type=${t.id}&page=1`)}
            >
              {t.label}
            </button>
          ))}
          {type !== 'maps' && (
            <span className="ml-auto text-sm text-slate-500 dark:text-slate-400">
              About {data?.totalResults ?? 0} results
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 md:px-6">
        {type === 'maps' && (
          <div className="glass-strong mx-auto max-w-2xl p-8">
            <div className="mb-4 flex items-center gap-2 font-display text-xl font-semibold">
              <MapPin className="h-6 w-6 text-[var(--senko-orange)]" />
              Maps
            </div>
            <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
              Open maps for &quot;{q || 'your query'}&quot; in an external provider. Senko does not host map tiles.
            </p>
            <div className="flex flex-col gap-3">
              <a
                href={mapsLinks.google}
                target="_blank"
                rel="noreferrer"
                className="glass flex items-center justify-between px-4 py-3 text-sm font-medium transition hover:border-[var(--senko-orange)]/40"
              >
                Google Maps
                <ExternalLink className="h-4 w-4 opacity-60" />
              </a>
              <a
                href={mapsLinks.osm}
                target="_blank"
                rel="noreferrer"
                className="glass flex items-center justify-between px-4 py-3 text-sm font-medium transition hover:border-[var(--senko-orange)]/40"
              >
                OpenStreetMap
                <ExternalLink className="h-4 w-4 opacity-60" />
              </a>
              <a
                href={mapsLinks.bing}
                target="_blank"
                rel="noreferrer"
                className="glass flex items-center justify-between px-4 py-3 text-sm font-medium transition hover:border-[var(--senko-orange)]/40"
              >
                Bing Maps
                <ExternalLink className="h-4 w-4 opacity-60" />
              </a>
            </div>
          </div>
        )}

        {type !== 'maps' && isLoading && (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-2xl bg-gradient-to-r from-white/40 via-white/20 to-white/40 dark:from-white/5 dark:via-white/10 dark:to-white/5"
              />
            ))}
          </div>
        )}

        {type !== 'maps' && !isLoading && data && data.totalResults === 0 && (
          <div className="flex flex-col items-center py-20 text-center">
            <FoxTailLogo size={80} animated glowing />
            <p className="mt-4 text-lg">No results found for &quot;{q}&quot;</p>
          </div>
        )}

        {type !== 'maps' && !isLoading && data && showWeb && (
          <div className="space-y-5">
            {data.results.map((r) => {
              const p = r.data as {
                id: string;
                url: string;
                title: string | null;
                description: string | null;
              };
              const host = hostnameFromUrl(p.url);
              const siteLabel = siteTitleFromHostname(host);
              return (
                <article key={p.id} className="glass p-5">
                  <div className="flex items-start gap-3">
                    <SiteFavicon hostname={host} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2 text-sm">
                        <span className="font-medium text-slate-800 dark:text-slate-100">{siteLabel}</span>
                        <span className="truncate text-[#0D8A4A]">{p.url}</span>
                      </div>
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 block font-display text-lg leading-snug text-[#1A5CFF] hover:underline"
                      >
                        {highlight(p.title, q)}
                      </a>
                      <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                        {highlight(p.description ?? '', q)}
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {type !== 'maps' && !isLoading && data && type === 'image' && (
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1 columns-1 gap-4 sm:columns-2 lg:columns-3">
              {data.results.map((r, idx) => {
                const img = r.data as {
                  id: string;
                  url: string;
                  pageUrl: string;
                  altText: string | null;
                  width: number | null;
                  height: number | null;
                  format: string | null;
                };
                const host = hostnameFromUrl(img.pageUrl);
                return (
                  <motion.div
                    key={img.id}
                    layout
                    className="group glass relative mb-4 break-inside-avoid overflow-hidden"
                  >
                    <button
                      type="button"
                      className="relative block w-full text-left"
                      onClick={() => setLightbox({ items: mediaItems, index: idx })}
                    >
                      <div className="flex items-center gap-2 border-b border-white/30 px-2 py-2 dark:border-white/[0.06]">
                        <SiteFavicon hostname={host} size={22} />
                        <span className="truncate text-xs text-slate-500 dark:text-slate-400">{host}</span>
                      </div>
                      <Image
                        src={img.url}
                        alt={img.altText ?? ''}
                        width={400}
                        height={300}
                        className="w-full object-cover"
                        unoptimized
                      />
                      <div className="absolute inset-0 top-10 flex items-end bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition group-hover:opacity-100">
                        <span className="line-clamp-2 text-left text-xs text-white">{img.altText}</span>
                      </div>
                    </button>
                    <ImageMetaPopover image={img} />
                  </motion.div>
                );
              })}
            </div>
            <ImageSuggestionsPanel query={q} safeParam={safeParam} />
          </div>
        )}

        {type !== 'maps' && !isLoading && data && type === 'video' && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {data.results.map((r) => {
              const v = r.data as {
                id: string;
                url: string;
                pageUrl: string;
                title: string | null;
                thumbnailUrl: string | null;
                platform: string | null;
              };
              const host = hostnameFromUrl(v.pageUrl);
              return (
                <button
                  key={v.id}
                  type="button"
                  className="glass relative overflow-hidden text-left"
                  onClick={() => setVideoModal(v.url)}
                >
                  <div className="flex items-center gap-2 border-b border-white/30 px-2 py-2 dark:border-white/[0.06]">
                    <SiteFavicon hostname={host} size={22} />
                    <span className="truncate text-xs text-slate-500 dark:text-slate-400">{host}</span>
                  </div>
                  <div className="relative aspect-video w-full bg-black">
                    {v.thumbnailUrl && (
                      <Image src={v.thumbnailUrl} alt="" fill className="object-cover" unoptimized />
                    )}
                    <span className="absolute left-2 top-12 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
                      {v.platform}
                    </span>
                    <Play className="pointer-events-none absolute inset-0 m-auto h-12 w-12 text-white drop-shadow" />
                  </div>
                  <div className="p-2 text-sm font-medium">{v.title}</div>
                </button>
              );
            })}
          </div>
        )}

        {type !== 'maps' && !isLoading && data && type === 'gif' && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {data.results.map((r, idx) => {
              const g = r.data as { id: string; url: string; pageUrl: string; altText: string | null };
              return (
                <button
                  key={g.id}
                  type="button"
                  className="glass overflow-hidden"
                  onClick={() => setLightbox({ items: mediaItems, index: idx })}
                >
                  <Image
                    src={g.url}
                    alt={g.altText ?? 'gif'}
                    width={400}
                    height={300}
                    className="h-48 w-full object-cover"
                    unoptimized
                  />
                </button>
              );
            })}
          </div>
        )}

        {type !== 'maps' && data && data.totalResults > 0 && (
          <div className="mt-10 flex justify-center gap-4">
            <button
              type="button"
              className="glass rounded-full px-5 py-2 text-sm font-medium transition hover:bg-white/60 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-white/10 dark:disabled:hover:bg-transparent"
              disabled={page <= 1}
              onClick={() =>
                router.push(`/search?q=${encodeURIComponent(q)}&type=${type}&page=${page - 1}`)
              }
            >
              Previous
            </button>
            <button
              type="button"
              className="glass rounded-full px-5 py-2 text-sm font-medium transition hover:bg-white/60 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-white/10 dark:disabled:hover:bg-transparent"
              disabled={page * (data.perPage ?? 10) >= data.totalResults}
              onClick={() =>
                router.push(`/search?q=${encodeURIComponent(q)}&type=${type}&page=${page + 1}`)
              }
            >
              Next
            </button>
          </div>
        )}
      </main>

      {lightbox && (
        <Lightbox items={lightbox.items} initialIndex={lightbox.index} onClose={() => setLightbox(null)} />
      )}

      {videoModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setVideoModal(null)}
        >
          <div className="aspect-video w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <iframe src={videoModal} className="h-full w-full rounded-lg" allowFullScreen title="video" />
          </div>
        </div>
      )}
    </div>
  );
}

function ImageMetaPopover({
  image,
}: {
  image: {
    url: string;
    altText: string | null;
    width: number | null;
    height: number | null;
    format: string | null;
    pageUrl: string;
  };
}) {
  const [open, setOpen] = useState(false);
  let host = '';
  try {
    host = new URL(image.pageUrl).hostname;
  } catch {
    host = '';
  }
  return (
    <div className="relative px-2 pb-2">
      <button
        type="button"
        className="mt-1 text-xs text-slate-500 underline dark:text-slate-400"
        onClick={() => setOpen((o) => !o)}
      >
        Info
      </button>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute left-2 top-full z-20 mt-1 w-64 rounded-xl border border-white/50 bg-white/90 p-3 text-xs shadow-glass backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/90 dark:shadow-glass-dark"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="flex items-center gap-2">
            <SiteFavicon hostname={host} size={20} />
            <span className="truncate text-senko-gray">{host}</span>
          </div>
          <div className="mt-2">
            {image.width}×{image.height} {image.format}
          </div>
          <div className="mt-1 line-clamp-3">{image.altText}</div>
          <button
            type="button"
            className="mt-2 text-[var(--senko-orange)]"
            onClick={() => void navigator.clipboard.writeText(image.url)}
          >
            Copy image URL
          </button>
        </motion.div>
      )}
    </div>
  );
}
