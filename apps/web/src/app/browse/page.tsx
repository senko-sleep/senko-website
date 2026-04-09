'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { ArrowLeft, ExternalLink, Globe, Server } from 'lucide-react';

function BrowseContent() {
  const searchParams = useSearchParams();
  const raw = searchParams.get('url')?.trim() ?? '';
  const initialProxy = searchParams.get('mode') === 'proxy';
  const [useProxy, setUseProxy] = useState(initialProxy);

  const canonical = useMemo(() => {
    try {
      const u = new URL(raw);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.href;
    } catch {
      return null;
    }
  }, [raw]);

  const iframeSrc = useMemo(() => {
    if (!canonical) return null;
    if (useProxy) {
      return `/api/browse-proxy?url=${encodeURIComponent(canonical)}`;
    }
    return canonical;
  }, [canonical, useProxy]);

  if (!raw) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 px-6 py-16 text-slate-700 dark:text-slate-300">
        <h1 className="font-display text-2xl font-semibold text-slate-900 dark:text-white">Browse</h1>
        <p className="text-sm leading-relaxed">
          Open this page with <code className="rounded bg-black/5 px-1.5 py-0.5 text-xs dark:bg-white/10">?url=https://example.com</code>{' '}
          or use <strong className="text-slate-900 dark:text-white">Browse here</strong> on web search results.
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

  if (!canonical || !iframeSrc) {
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
        <div className="flex shrink-0 items-center gap-1 rounded-full border border-black/10 p-0.5 dark:border-white/10">
          <button
            type="button"
            onClick={() => setUseProxy(false)}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition ${
              !useProxy
                ? 'bg-[var(--senko-orange)] text-white shadow-sm'
                : 'text-slate-600 hover:bg-black/5 dark:text-slate-400 dark:hover:bg-white/5'
            }`}
          >
            <Globe className="h-3.5 w-3.5" aria-hidden />
            Direct
          </button>
          <button
            type="button"
            onClick={() => setUseProxy(true)}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition ${
              useProxy
                ? 'bg-[var(--senko-orange)] text-white shadow-sm'
                : 'text-slate-600 hover:bg-black/5 dark:text-slate-400 dark:hover:bg-white/5'
            }`}
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
      {useProxy ? (
        <p className="shrink-0 border-b border-amber-500/25 bg-amber-500/10 px-3 py-2 text-center text-[11px] text-amber-900 dark:text-amber-100/90">
          Proxy mode rewrites the HTML document and sets a base URL so CSS/JS/images usually load from the original host.
          Many SPAs and logged-in flows still break; complex sites work best in <strong>Direct</strong> or <strong>New tab</strong>.
        </p>
      ) : (
        <p className="shrink-0 border-b border-slate-200/80 bg-white/50 px-3 py-2 text-center text-[11px] text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
          Direct mode loads the real site in a frame. If you see a blank area, the site blocks embedding — try <strong>Proxy</strong> or{' '}
          <strong>New tab</strong>.
        </p>
      )}
      <iframe
        key={iframeSrc}
        src={iframeSrc}
        className="min-h-0 w-full flex-1 border-0 bg-white dark:bg-black"
        title="Embedded page"
        referrerPolicy="no-referrer-when-downgrade"
      />
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
