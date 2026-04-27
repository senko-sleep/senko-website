'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, Globe, Maximize2, Minimize2, Monitor, Server } from 'lucide-react';
import { embedPlayerUrl, isDirectVideoAssetUrl } from '@/lib/videoEmbed';

const FS_PREF_KEY = 'senko-browse-auto-theater-fs';

type Viewer =
  | { mode: 'iframe'; src: string }
  | { mode: 'video'; src: string }
  | null;

function BrowseContent() {
  const searchParams = useSearchParams();
  const raw = searchParams.get('url')?.trim() ?? '';
  const initialProxy = searchParams.get('mode') === 'proxy';
  const [useProxy, setUseProxy] = useState(initialProxy);
  const [autoTheaterFs, setAutoTheaterFs] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [uiFullscreen, setUiFullscreen] = useState(false);

  useEffect(() => {
    try {
      setAutoTheaterFs(localStorage.getItem(FS_PREF_KEY) === '1');
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const onFs = () => setUiFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const canonical = useMemo(() => {
    try {
      const u = new URL(raw);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.href;
    } catch {
      return null;
    }
  }, [raw]);

  const viewer: Viewer = useMemo(() => {
    if (!canonical) return null;
    if (isDirectVideoAssetUrl(canonical)) {
      const src = useProxy
        ? `/api/browse-proxy?url=${encodeURIComponent(canonical)}`
        : canonical;
      return { mode: 'video', src };
    }
    const embed = embedPlayerUrl(canonical, { autoplay: true, allowInlineFullscreen: true });
    if (embed) return { mode: 'iframe', src: embed };
    if (useProxy) return { mode: 'iframe', src: `/api/browse-proxy?url=${encodeURIComponent(canonical)}` };
    return { mode: 'iframe', src: canonical };
  }, [canonical, useProxy]);

  const isEmbeddedVideo = Boolean(
    canonical && !isDirectVideoAssetUrl(canonical) && embedPlayerUrl(canonical),
  );
  const isDirectFile = Boolean(canonical && isDirectVideoAssetUrl(canonical));

  useEffect(() => {
    if (!autoTheaterFs || !isEmbeddedVideo) return;
    const id = window.setTimeout(() => {
      stageRef.current?.requestFullscreen().catch(() => {});
    }, 500);
    return () => clearTimeout(id);
  }, [autoTheaterFs, isEmbeddedVideo, viewer?.src]);

  const toggleUiFullscreen = useCallback(async () => {
    const el = stageRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) await el.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      /* ignore */
    }
  }, []);

  const persistAutoFs = useCallback((on: boolean) => {
    setAutoTheaterFs(on);
    try {
      localStorage.setItem(FS_PREF_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);

  if (!raw) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 px-6 py-16 text-slate-700 dark:text-slate-300">
        <h1 className="font-display text-2xl font-semibold text-slate-900 dark:text-white">Browse</h1>
        <p className="text-sm leading-relaxed">
          Open this page with <code className="rounded bg-black/5 px-1.5 py-0.5 text-xs dark:bg-white/10">?url=https://example.com</code>{' '}
          or use <strong className="text-slate-900 dark:text-white">Browse here</strong> on web search results. Video
          watch URLs use an embedded player (YouTube, Vimeo, Dailymotion). Direct .mp4/.webm links use the native
          video controls.
        </p>
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-2 rounded-full bg-[var(--senko-orange)] px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-95"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back home
        </Link>
      </div>
    );
  }

  if (!canonical || !viewer) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-slate-600 dark:text-slate-400">
        <p>That URL is not supported (use http or https).</p>
        <Link href="/" className="text-[var(--senko-orange)] hover:underline">
          Home
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-slate-100 text-slate-900 dark:bg-[#0c0e12] dark:text-slate-100">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-black/10 bg-white/80 px-2 py-2 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/75">
        <Link
          href="/search?type=web"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Search
        </Link>
        <span className="min-w-0 flex-1 truncate px-1 font-mono text-[11px] text-slate-500 dark:text-slate-400" title={canonical}>
          {canonical}
        </span>
        <label className="hidden shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-black/10 px-2 py-1 text-[10px] sm:inline-flex dark:border-white/10">
          <input
            type="checkbox"
            className="rounded border-slate-400"
            checked={autoTheaterFs}
            onChange={(e) => persistAutoFs(e.target.checked)}
          />
          <Monitor className="h-3 w-3" aria-hidden />
          Auto full screen
        </label>
        <button
          type="button"
          onClick={() => void toggleUiFullscreen()}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
          title={uiFullscreen ? 'Exit full screen' : 'Full screen viewer'}
        >
          {uiFullscreen ? <Minimize2 className="h-3.5 w-3.5" aria-hidden /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden />}
          {uiFullscreen ? 'Exit' : 'Full screen'}
        </button>
        <div className="flex shrink-0 items-center gap-1 rounded-full border border-black/10 p-0.5 dark:border-white/10">
          <button
            type="button"
            onClick={() => setUseProxy(false)}
            disabled={Boolean(isEmbeddedVideo)}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-35 ${
              !useProxy
                ? 'bg-[var(--senko-orange)] text-white shadow-sm'
                : 'text-slate-600 hover:bg-black/5 dark:text-slate-400 dark:hover:bg-white/5'
            }`}
            title={isEmbeddedVideo ? 'Video uses embed player' : undefined}
          >
            <Globe className="h-3.5 w-3.5" aria-hidden />
            Direct
          </button>
          <button
            type="button"
            onClick={() => setUseProxy(true)}
            disabled={Boolean(isEmbeddedVideo)}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-35 ${
              useProxy
                ? 'bg-[var(--senko-orange)] text-white shadow-sm'
                : 'text-slate-600 hover:bg-black/5 dark:text-slate-400 dark:hover:bg-white/5'
            }`}
            title={
              isEmbeddedVideo
                ? 'Not used for embedded video hosts'
                : isDirectFile
                  ? 'Stream file through this app'
                  : undefined
            }
          >
            <Server className="h-3.5 w-3.5" aria-hidden />
            Proxy
          </button>
        </div>
        <a
          href={canonical}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          New tab
        </a>
      </header>
      {isDirectFile ? (
        <p className="shrink-0 border-b border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-center text-[11px] text-emerald-950 dark:text-emerald-100/90">
          <strong>Direct media</strong> — native video element. With <strong>Proxy</strong> on, the file is streamed
          through this app (helps with some hotlinks). Use <strong>Full screen</strong> for theater layout.
        </p>
      ) : isEmbeddedVideo ? (
        <p className="shrink-0 border-b border-sky-500/25 bg-sky-500/10 px-3 py-2 text-center text-[11px] text-sky-950 dark:text-sky-100/90">
          <strong>Video embed</strong> — playing in an official player iframe (works with YouTube, Vimeo, Dailymotion
          watch links). Use <strong>Full screen</strong> for theater mode; enable <strong>Auto full screen</strong> on
          desktop to enter it automatically.
        </p>
      ) : useProxy ? (
        <p className="shrink-0 border-b border-amber-500/25 bg-amber-500/10 px-3 py-2 text-center text-[11px] text-amber-900 dark:text-amber-100/90">
          Proxy mode rewrites HTML and sets a base URL. Many SPAs still break; try <strong>Direct</strong> or{' '}
          <strong>New tab</strong>.
        </p>
      ) : (
        <p className="shrink-0 border-b border-slate-200/80 bg-white/50 px-3 py-2 text-center text-[11px] text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
          Direct mode — if the frame is blank, the site blocks embedding; try <strong>Proxy</strong> or{' '}
          <strong>New tab</strong>.
        </p>
      )}
      <div
        ref={stageRef}
        className="relative min-h-0 w-full flex-1 bg-black outline-none [&:fullscreen]:bg-black"
      >
        {viewer.mode === 'video' ? (
          <video
            key={viewer.src}
            src={viewer.src}
            className="h-full w-full object-contain"
            controls
            playsInline
            preload="metadata"
            title="Video"
          />
        ) : (
          <iframe
            key={viewer.src}
            src={viewer.src}
            className="h-full w-full border-0"
            title={isEmbeddedVideo ? 'Embedded video' : 'Embedded page'}
            referrerPolicy="no-referrer-when-downgrade"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share"
            allowFullScreen
          />
        )}
      </div>
    </div>
  );
}

export default function BrowsePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-600 dark:bg-[#0c0e12] dark:text-slate-400">
          Loading…
        </div>
      }
    >
      <BrowseContent />
    </Suspense>
  );
}
