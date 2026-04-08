'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import FoxTailLogo from '@/components/FoxTailLogo';
import SearchBar from '@/components/SearchBar';
import StartShortcuts from '@/components/StartShortcuts';
import type { SearchTab } from '@/lib/history';
import useSWR from 'swr';
import axios from 'axios';
import { apiUrl } from '@/lib/api';
import { addHistory } from '@/lib/history';
import { useClientDark } from '@/lib/useClientDark';
import DarkModeToggle from '@/components/DarkModeToggle';
import SafeSearchToggle, { useSafeSearch } from '@/components/SafeSearchToggle';

const tabs: { id: SearchTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'web', label: 'Search' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Videos' },
  { id: 'maps', label: 'Maps' },
  { id: 'news', label: 'News' },
];

export default function HomePage() {
  const router = useRouter();
  const clientDark = useClientDark();
  const [tab, setTab] = useState<SearchTab>('all');
  const [safe, setSafe] = useSafeSearch();

  const { data: trending } = useSWR(
    apiUrl('/api/trending'),
    async (u) => {
      try {
        const res = await axios.get<{ trending: { query: string; score: number }[] }>(u);
        return res.data;
      } catch {
        return { trending: [] as { query: string; score: number }[] };
      }
    },
    { refreshInterval: 60_000, shouldRetryOnError: false },
  );

  const onSubmit = (q: string, t: SearchTab) => {
    addHistory(q, t);
    router.push(`/search?q=${encodeURIComponent(q)}&type=${t}`);
  };

  return (
    <main className="relative min-h-screen text-slate-900 dark:text-slate-100">
      <header className="absolute right-0 top-0 z-20 flex items-center gap-3 p-4 md:p-6">
        <SafeSearchToggle safe={safe} onChange={setSafe} />
        <DarkModeToggle />
      </header>

      <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 pb-20 pt-10 md:px-6 md:pt-16">
        <motion.div
          className="glass-strong relative overflow-hidden px-6 py-10 md:px-10 md:py-12"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gradient-to-br from-blue-400/20 to-[var(--senko-orange)]/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-gradient-to-tr from-indigo-400/15 to-transparent blur-2xl" />

          <div className="relative flex flex-col items-center text-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.05, duration: 0.45 }}
            >
              <FoxTailLogo size={112} animated glowing={clientDark} />
            </motion.div>
            <h1 className="mt-6 font-display text-4xl font-bold tracking-tight text-slate-900 md:text-5xl dark:text-white">
              Senko Search
            </h1>
            <p className="mt-2 text-sm font-medium text-slate-500 dark:text-slate-400">
              Quick as a fox, sharp as a search.
            </p>

            <div className="mt-8 w-full max-w-xl">
              <SearchBar onSubmitSearch={onSubmit} activeTab={tab} showSubmitButton />
            </div>

            <div className="mt-5 flex flex-wrap justify-center gap-1.5">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`glass-tab ${tab === t.id ? 'glass-tab-active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.45 }}
        >
          <StartShortcuts />
        </motion.div>

        {trending && trending.trending.length > 0 && (
          <motion.div
            className="glass mt-8 p-5 md:p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25 }}
          >
            <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Trending now
            </h2>
            <ul className="mt-4 space-y-3">
              {trending.trending.map((item, i) => (
                <li key={item.query} className="flex items-center gap-3 text-sm">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/50 text-xs font-bold text-slate-500 dark:bg-white/10 dark:text-slate-400">
                    {i + 1}
                  </span>
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left font-medium text-[var(--senko-orange)] hover:underline"
                    onClick={() => onSubmit(item.query, 'web')}
                  >
                    {item.query}
                  </button>
                  <span className="hidden h-2 w-20 overflow-hidden rounded-full bg-slate-200/80 sm:block dark:bg-white/10">
                    <span
                      className="block h-full rounded-full bg-gradient-to-r from-[var(--senko-orange)] to-orange-400"
                      style={{ width: `${Math.min(100, item.score * 5)}%` }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>
        )}

        <footer className="mt-auto pt-16 text-center text-xs text-slate-500 dark:text-slate-500">
          Senko Search — glass, fast, curious.
        </footer>
      </div>
    </main>
  );
}
