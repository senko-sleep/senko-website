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

const fetcher = (url: string) => axios.get<string[]>(url).then((r) => r.data);

export default function ImageSuggestionsPanel({ query, safeParam }: Props) {
  const router = useRouter();
  const suggestUrl =
    query.length >= 2 ? apiUrl(`/api/suggest?q=${encodeURIComponent(query)}`) : null;
  const { data: suggestions } = useSWR(suggestUrl, fetcher);
  const trendUrl = apiUrl('/api/trending');
  const { data: trending } = useSWR(trendUrl, (u) =>
    axios.get<{ trending: { query: string; score: number }[] }>(u).then((r) => r.data),
  );

  const go = (q: string, type: SearchTab = 'image') => {
    router.push(`/search?q=${encodeURIComponent(q)}&type=${type}&page=1&safe=${safeParam}`);
  };

  return (
    <aside className="flex w-full flex-col gap-6 lg:w-80 lg:shrink-0">
      <motion.div layout className="glass p-5 shadow-glass dark:shadow-glass-dark">
        <h3 className="font-display text-sm font-semibold text-slate-800 dark:text-slate-100">
          Related searches
        </h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {(suggestions ?? []).map((s) => (
            <button
              key={s}
              type="button"
              className="rounded-full border border-white/40 bg-white/50 px-3 py-1 text-xs font-medium text-slate-800 shadow-sm backdrop-blur-sm transition hover:border-[var(--senko-orange)]/50 hover:bg-white/70 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10"
              onClick={() => go(s, 'image')}
            >
              {s}
            </button>
          ))}
          {(!suggestions || suggestions.length === 0) && (
            <p className="text-xs text-slate-500 dark:text-slate-400">Type more characters for suggestions.</p>
          )}
        </div>
      </motion.div>

      <div className="glass p-5 shadow-glass dark:shadow-glass-dark">
        <h3 className="font-display text-sm font-semibold text-slate-800 dark:text-slate-100">Trending</h3>
        <ul className="mt-3 space-y-2">
          {(trending?.trending ?? []).slice(0, 8).map((t) => (
            <li key={t.query}>
              <button
                type="button"
                className="text-left text-sm text-[var(--senko-orange)] hover:underline"
                onClick={() => go(t.query, 'image')}
              >
                {t.query}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="glass border border-dashed border-white/40 p-4 text-xs text-slate-500 dark:border-white/10 dark:text-slate-400">
        Tip: open an image for a full-screen gallery view. Use related searches to explore visually similar topics.
      </div>
    </aside>
  );
}
