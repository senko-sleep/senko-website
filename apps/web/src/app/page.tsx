'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import FoxTailLogo from '@/components/FoxTailLogo';
import SearchBar from '@/components/SearchBar';
import type { SearchTab } from '@/lib/history';
import { addHistory } from '@/lib/history';
import { useClientDark } from '@/lib/useClientDark';
import DarkModeToggle from '@/components/DarkModeToggle';
import SafeSearchToggle from '@/components/SafeSearchToggle';
import { usePrefs } from '@/lib/prefsContext';

const tabs: { id: SearchTab; label: string }[] = [
  { id: 'web', label: 'Search' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Videos' },
];

export default function HomePage() {
  const router = useRouter();
  const clientDark = useClientDark();
  const { safeSearch, setSafeSearch, activeTab, setActiveTab } = usePrefs();

  const onSubmit = (q: string, t: SearchTab) => {
    addHistory(q, t);
    router.push(`/search?q=${encodeURIComponent(q)}&type=${t}&safe=${safeSearch ? '1' : '0'}`);
  };

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[#eef1f4] text-slate-900 dark:bg-[#111214] dark:text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[16%] h-64 w-64 -translate-x-1/2 rounded-full bg-[var(--senko-orange)]/10 blur-3xl dark:bg-[var(--senko-orange)]/14" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-black/10 to-transparent dark:via-white/10" />
      </div>
      <header className="absolute right-0 top-0 z-20 flex items-center gap-2 p-3 md:p-4">
        <SafeSearchToggle safe={safeSearch} onChange={setSafeSearch} compact />
        <DarkModeToggle />
      </header>

      <div className="relative flex flex-1 flex-col items-center justify-center px-4 pb-20 pt-14 md:px-6">
        <div className="mx-auto flex w-full max-w-[760px] flex-col items-center text-center">
          <FoxTailLogo size={72} animated glowing={clientDark} />
          <h1 className="mt-4 font-display text-[2.6rem] font-normal tracking-tight text-slate-800 md:text-[4.2rem] dark:text-slate-50">
            Senko
          </h1>
          <p className="mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
            Faster search, cleaner suggestions, and a lighter surface.
          </p>

          <div className="mt-7 w-full self-center">
            <SearchBar
              variant="hero"
              onSubmitSearch={onSubmit}
              activeTab={activeTab}
              showSubmitButton={false}
            />
          </div>

          <nav
            className="mt-6 flex max-w-lg flex-wrap justify-center gap-x-5 gap-y-2 text-sm"
            aria-label="Search categories"
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`rounded-full px-1 py-0.5 transition-colors ${
                  activeTab === t.id
                    ? 'font-medium text-slate-900 underline decoration-slate-400 decoration-1 underline-offset-4 dark:text-white dark:decoration-slate-500'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <footer className="pb-6 text-center text-[11px] text-slate-400 dark:text-slate-600">
        Senko Search
      </footer>
    </main>
  );
}
