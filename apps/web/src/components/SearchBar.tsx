'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, Clock, Sparkles, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { apiUrl } from '@/lib/api';
import { loadHistory, saveHistory, type HistoryEntry, type SearchTab } from '@/lib/history';

export type { SearchTab };

/** Bold the typed segment in a suggestion (Bing-style match highlight). */
function SuggestionLabel({ query, text }: { query: string; text: string }) {
  const q = query.trim();
  if (!q) return <span className="text-slate-800 dark:text-slate-100">{text}</span>;
  const tl = text.toLowerCase();
  const ql = q.toLowerCase();
  const bold = (chunk: string) => (
    <span className="font-semibold text-[var(--senko-orange)] dark:text-orange-300">{chunk}</span>
  );
  if (tl.startsWith(ql)) {
    return (
      <span className="text-slate-800 dark:text-slate-100">
        {bold(text.slice(0, q.length))}
        {text.slice(q.length)}
      </span>
    );
  }
  const at = tl.indexOf(ql);
  if (at >= 0) {
    return (
      <span className="text-slate-800 dark:text-slate-100">
        {text.slice(0, at)}
        {bold(text.slice(at, at + q.length))}
        {text.slice(at + q.length)}
      </span>
    );
  }
  return <span className="text-slate-800 dark:text-slate-100">{text}</span>;
}

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
  const [suggestLoading, setSuggestLoading] = useState(false);
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
      setSuggestLoading(false);
      return;
    }
    setSuggestLoading(true);
    try {
      const res = await axios.get<string[]>(apiUrl(`/api/suggest?q=${encodeURIComponent(partial)}`));
      setSuggestions(res.data);
    } catch {
      setSuggestions([]);
    } finally {
      setSuggestLoading(false);
    }
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

  const historyRows = useMemo(
    () =>
      history
        .filter((h) => h.query.toLowerCase().includes(q.toLowerCase()))
        .map((h) => ({ kind: 'history' as const, text: h.query, ts: h.timestamp })),
    [history, q],
  );
  const suggestRows = useMemo(
    () => suggestions.map((s) => ({ kind: 'suggest' as const, text: s })),
    [suggestions],
  );
  const combined = [...historyRows, ...suggestRows].slice(0, 10);

  const showDropdown =
    open &&
    (combined.length > 0 ||
      (q.length >= 2 && suggestLoading && suggestRows.length === 0 && historyRows.length === 0));

  useEffect(() => {
    setActiveIdx((i) => Math.min(i, Math.max(0, combined.length - 1)));
  }, [combined.length]);

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
        {showDropdown && (
          <motion.ul
            id={listId}
            role="listbox"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="absolute left-0 right-0 top-full z-40 mt-2 max-h-[22rem] overflow-auto rounded-2xl border border-white/60 bg-white/85 p-1.5 shadow-glass backdrop-blur-2xl dark:border-white/[0.08] dark:bg-slate-900/90 dark:shadow-glass-dark"
          >
            {historyRows.length > 0 && (
              <>
                <li className="flex items-center justify-between px-3 pb-1.5 pt-1">
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    <Clock className="h-3.5 w-3.5" aria-hidden />
                    Recent
                  </span>
                  <button
                    type="button"
                    className="text-[11px] font-medium text-[var(--senko-orange)] hover:underline"
                    onClick={clearHistory}
                  >
                    Clear
                  </button>
                </li>
                {historyRows.map((c, idx) => {
                  const i = idx;
                  return (
                    <li
                      key={`history-${c.ts}`}
                      id={`opt-${i}`}
                      role="option"
                      aria-selected={i === activeIdx}
                      onMouseEnter={() => setActiveIdx(i)}
                    >
                      <button
                        type="button"
                        className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left text-sm transition-colors ${
                          i === activeIdx
                            ? 'bg-gradient-to-r from-orange-500/12 to-transparent dark:from-orange-400/10'
                            : 'hover:bg-white/60 dark:hover:bg-white/[0.04]'
                        }`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setQ(c.text);
                          onSubmitSearch(c.text, activeTab);
                          setOpen(false);
                        }}
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-orange-200/60 bg-gradient-to-br from-orange-50 to-amber-50/80 text-[var(--senko-orange)] shadow-sm dark:border-orange-500/20 dark:from-orange-950/40 dark:to-amber-950/30">
                          <Clock className="h-4 w-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <SuggestionLabel query={q} text={c.text} />
                        </span>
                        <span className="shrink-0 rounded-full bg-slate-100/90 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:bg-white/10 dark:text-slate-400">
                          Recent
                        </span>
                      </button>
                    </li>
                  );
                })}
                {suggestRows.length > 0 && (
                  <li className="my-1.5 h-px bg-gradient-to-r from-transparent via-slate-200/80 to-transparent dark:via-white/10" />
                )}
              </>
            )}

            {(suggestRows.length > 0 || (q.length >= 2 && suggestLoading)) && (
              <li className="flex items-center gap-1.5 px-3 pb-1.5 pt-1">
                <Sparkles className="h-3.5 w-3.5 text-blue-500 dark:text-sky-400" aria-hidden />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Suggestions
                </span>
                {suggestLoading && (
                  <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin text-slate-400" aria-hidden />
                )}
              </li>
            )}

            {suggestRows.map((c, idx) => {
              const i = historyRows.length + idx;
              return (
                <li
                  key={`suggest-${c.text}-${idx}`}
                  id={`opt-${i}`}
                  role="option"
                  aria-selected={i === activeIdx}
                  onMouseEnter={() => setActiveIdx(i)}
                >
                  <button
                    type="button"
                    className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left text-sm transition-colors ${
                      i === activeIdx
                        ? 'bg-gradient-to-r from-sky-500/12 to-transparent dark:from-sky-400/10'
                        : 'hover:bg-white/60 dark:hover:bg-white/[0.04]'
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setQ(c.text);
                      onSubmitSearch(c.text, activeTab);
                      setOpen(false);
                    }}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sky-200/70 bg-gradient-to-br from-sky-50 to-blue-50/90 text-sky-600 shadow-sm dark:border-sky-500/25 dark:from-sky-950/50 dark:to-blue-950/40 dark:text-sky-300">
                      <Sparkles className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <SuggestionLabel query={q} text={c.text} />
                    </span>
                    <span className="shrink-0 rounded-full bg-sky-100/90 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                      Index
                    </span>
                  </button>
                </li>
              );
            })}

            {q.length >= 2 && suggestLoading && suggestRows.length === 0 && historyRows.length === 0 && (
              <li className="space-y-2 px-2 py-3">
                {[0, 1, 2].map((k) => (
                  <div
                    key={k}
                    className="flex items-center gap-3 rounded-xl px-2.5 py-2"
                  >
                    <span className="h-9 w-9 animate-pulse rounded-xl bg-slate-200/80 dark:bg-white/10" />
                    <span className="h-4 flex-1 animate-pulse rounded-md bg-slate-200/70 dark:bg-white/10" />
                  </div>
                ))}
              </li>
            )}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
