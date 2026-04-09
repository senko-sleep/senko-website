'use client';

import useSWR from 'swr';
import axios from 'axios';
import { motion } from 'framer-motion';
import { apiUrl } from '@/lib/api';
import { useRouter } from 'next/navigation';
import type { SearchTab } from '@/lib/history';

interface Props {
  query: string;
  safeParam: string;
}

async function suggestFetcher(url: string): Promise<string[]> {
  try {
    const r = await axios.get<string[]>(url);
    return r.data;
  } catch {
    return [];
  }
}

export default function ImageSuggestionsPanel({ query, safeParam }: Props) {
  const router = useRouter();
  const suggestUrl =
    query.length >= 2 ? apiUrl(`/api/suggest?q=${encodeURIComponent(query)}`) : null;
  const { data: suggestions } = useSWR(suggestUrl, suggestFetcher, {
    shouldRetryOnError: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 30000,
  });
  const trendUrl = apiUrl('/api/trending');
  const { data: trending } = useSWR(
    trendUrl,
    async (u) => {
      try {
        const r = await axios.get<{ trending: { query: string; score: number }[] }>(u);
        return r.data;
      } catch {
        return { trending: [] as { query: string; score: number }[] };
      }
    },
    { shouldRetryOnError: false, revalidateOnFocus: false, revalidateOnReconnect: false },
  );

  const go = (q: string, type: SearchTab = 'image') => {
    router.push(`/search?q=${encodeURIComponent(q)}&type=${type}&page=1&safe=${safeParam}`);
  };

  return (
    <aside className="flex w-full flex-col gap-5 lg:w-[17.5rem] lg:shrink-0">
      <motion.div
        layout
        className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white/[0.65] shadow-[0_4px_24px_rgba(0,0,0,0.06)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#12161c]/90 dark:shadow-[0_8px_32px_rgba(0,0,0,0.35)]"
      >
        <div className="border-b border-black/[0.04] px-4 py-3 dark:border-white/[0.06]">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
            Related
          </h3>
        </div>
        <div className="p-4">
          <div className="flex flex-wrap gap-2">
            {(suggestions ?? []).map((s) => (
              <button
                key={s}
                type="button"
                className="rounded-full bg-slate-900/[0.06] px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-slate-900/[0.1] dark:bg-white/[0.08] dark:text-slate-100 dark:hover:bg-white/[0.12]"
                onClick={() => go(s, 'image')}
              >
                {s}
              </button>
            ))}
            {(!suggestions || suggestions.length === 0) && (
              <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Keep typing — we&apos;ll suggest refinements here.
              </p>
            )}
          </div>
        </div>
      </motion.div>

      <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white/[0.65] shadow-[0_4px_24px_rgba(0,0,0,0.06)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#12161c]/90 dark:shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
        <div className="border-b border-black/[0.04] px-4 py-3 dark:border-white/[0.06]">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
            Trending
          </h3>
        </div>
        <ul className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
          {(trending?.trending ?? []).slice(0, 8).map((t) => (
            <li key={t.query}>
              <button
                type="button"
                className="w-full px-4 py-2.5 text-left text-sm text-slate-800 transition hover:bg-slate-900/[0.04] dark:text-slate-100 dark:hover:bg-white/[0.04]"
                onClick={() => go(t.query, 'image')}
              >
                {t.query}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl border border-dashed border-slate-300/60 bg-slate-50/50 px-4 py-3 text-xs leading-relaxed text-slate-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
        Click a tile to open the gallery. Hover for source page and copy image link.
      </div>
    </aside>
  );
}
