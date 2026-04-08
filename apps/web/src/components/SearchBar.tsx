'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { apiUrl } from '@/lib/api';
import { loadHistory, saveHistory, type HistoryEntry, type SearchTab } from '@/lib/history';

export type { SearchTab };

interface SearchBarProps {
  initialQuery?: string;
  compact?: boolean;
  onSubmitSearch: (q: string, tab: SearchTab) => void;
  activeTab: SearchTab;
  showSubmitButton?: boolean;
}

export default function SearchBar({
  initialQuery = '',
  compact = false,
  onSubmitSearch,
  activeTab,
  showSubmitButton = false,
}: SearchBarProps) {
  const [q, setQ] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listId = 'senko-suggest-list';

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  useEffect(() => {
    setQ(initialQuery);
  }, [initialQuery]);

  const fetchSuggest = useCallback(async (partial: string) => {
    if (partial.length < 2) {
      setSuggestions([]);
      return;
    }
    const res = await axios.get<string[]>(apiUrl(`/api/suggest?q=${encodeURIComponent(partial)}`));
    setSuggestions(res.data);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchSuggest(q);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, fetchSuggest]);

  const combined = [
    ...history.filter((h) => h.query.toLowerCase().includes(q.toLowerCase())).map((h) => ({ kind: 'history' as const, text: h.query })),
    ...suggestions.map((s) => ({ kind: 'suggest' as const, text: s })),
  ].slice(0, 8);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open || combined.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, combined.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    }
    if (e.key === 'Enter' && combined[activeIdx]) {
      e.preventDefault();
      const pick = combined[activeIdx]!;
      setQ(pick.text);
      onSubmitSearch(pick.text, activeTab);
      setOpen(false);
    }
  };

  const clearHistory = () => {
    saveHistory([]);
    setHistory([]);
  };

  const submit = () => {
    if (!q.trim()) return;
    onSubmitSearch(q.trim(), activeTab);
    setOpen(false);
  };

  return (
    <div className="relative w-full max-w-2xl">
      <div className="flex w-full items-center gap-2">
        <div
          className={`glass-input flex flex-1 items-center gap-3 px-4 ${compact ? 'py-2.5' : 'py-3.5'}`}
        >
          <Search className="h-5 w-5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
          <input
            className="flex-1 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
            placeholder="Search the web, images, videos..."
            value={q}
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={combined[activeIdx] ? `opt-${activeIdx}` : undefined}
            role="combobox"
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
              setActiveIdx(0);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />
        </div>
        {showSubmitButton && (
          <button
            type="button"
            className="rounded-full bg-gradient-to-r from-[var(--senko-orange)] to-orange-500 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-orange-500/25 transition hover:brightness-105 active:scale-[0.98]"
            onClick={submit}
          >
            Search
          </button>
        )}
      </div>
      <AnimatePresence>
        {open && (combined.length > 0 || history.length > 0) && (
          <motion.ul
            id={listId}
            role="listbox"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="absolute left-0 right-0 top-full z-40 mt-2 max-h-80 overflow-auto rounded-2xl border border-white/50 bg-white/80 p-2 shadow-glass backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/80 dark:shadow-glass-dark"
          >
            {history.length > 0 && (
              <li className="flex items-center justify-between px-2 py-1 text-xs text-senko-gray">
                <span>Recent</span>
                <button type="button" className="text-[var(--senko-orange)]" onClick={clearHistory}>
                  Clear
                </button>
              </li>
            )}
            {combined.map((c, i) => (
              <li key={`${c.kind}-${c.text}-${i}`} id={`opt-${i}`} role="option">
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                    i === activeIdx ? 'bg-[var(--senko-cream)] dark:bg-white/5' : ''
                  }`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setQ(c.text);
                    onSubmitSearch(c.text, activeTab);
                    setOpen(false);
                  }}
                >
                  <Search className="h-4 w-4 opacity-60" />
                  <span>{c.text}</span>
                  {c.kind === 'history' && <span className="ml-auto text-xs text-senko-gray">history</span>}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
