'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo, useDeferredValue } from 'react';
import { Search, Clock, Loader2, ArrowUpRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios, { isAxiosError } from 'axios';
import { apiUrl } from '@/lib/api';
import { loadHistory, type HistoryEntry, type SearchTab } from '@/lib/history';

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
  /** Wide cinematic pill (home) vs compact toolbar (search) */
  variant?: 'default' | 'hero';
  onSubmitSearch: (q: string, tab: SearchTab) => void;
  activeTab: SearchTab;
  showSubmitButton?: boolean;
}

export default function SearchBar({
  initialQuery = '',
  compact = false,
  variant = 'default',
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
  const suggestAbortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const listId = 'senko-suggest-list';
  const deferredQuery = useDeferredValue(q);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  useEffect(() => {
    setQ(initialQuery);
  }, [initialQuery]);

  const fetchSuggest = useCallback(async (partial: string) => {
    const normalized = partial.trim();
    if (normalized.length < 1) {
      setSuggestions([]);
      setSuggestLoading(false);
      return;
    }

    suggestAbortRef.current?.abort();
    const ac = new AbortController();
    suggestAbortRef.current = ac;

    const requestId = ++requestIdRef.current;
    setSuggestLoading(true);
    try {
      const res = await axios.get<string[]>(apiUrl(`/api/suggest?q=${encodeURIComponent(normalized)}`), {
        signal: ac.signal,
        timeout: 5_000,
      });
      if (requestId === requestIdRef.current) {
        setSuggestions(res.data);
      }
    } catch (e) {
      if (isAxiosError(e) && e.code === 'ERR_CANCELED') return;
      if (requestId === requestIdRef.current) {
        setSuggestions([]);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setSuggestLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchSuggest(deferredQuery);
    }, 120);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [deferredQuery, fetchSuggest]);

  const normalizedQuery = q.trim().toLowerCase();

  const historyRows = useMemo(
    () =>
      history
        .filter((h) => normalizedQuery.length >= 2 && h.query.toLowerCase().startsWith(normalizedQuery))
        .slice(0, 2)
        .map((h) => ({ kind: 'history' as const, text: h.query, ts: h.timestamp })),
    [history, normalizedQuery],
  );
  const suggestRows = useMemo(
    () => suggestions.map((s) => ({ kind: 'suggest' as const, text: s })),
    [suggestions],
  );
  const liveRows = useMemo(() => {
    const seen = new Set<string>();
    return suggestRows
      .filter((row) => {
        const key = row.text.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6);
  }, [suggestRows]);
  const recentRows = useMemo(() => {
    if (liveRows.length > 0) return [];
    const seen = new Set(liveRows.map((row) => row.text.toLowerCase()));
    return historyRows.filter((row) => {
      const key = row.text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [historyRows, liveRows]);
  const combined = useMemo(() => [...liveRows, ...recentRows], [liveRows, recentRows]);

  const showDropdown =
    open &&
    (combined.length > 0 ||
      (normalizedQuery.length >= 1 && suggestLoading && liveRows.length === 0 && recentRows.length === 0));

  useEffect(() => {
    setActiveIdx((i) => Math.min(i, Math.max(0, combined.length - 1)));
  }, [combined.length]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'Enter') {
      if (open && combined[activeIdx]) {
        e.preventDefault();
        const pick = combined[activeIdx]!;
        setQ(pick.text);
        onSubmitSearch(pick.text, activeTab);
        setOpen(false);
      } else if (q.trim()) {
        e.preventDefault();
        submit();
      }
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
  };

  const submit = () => {
    if (!q.trim()) return;
    suggestAbortRef.current?.abort();
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setSuggestLoading(false);
    onSubmitSearch(q.trim(), activeTab);
    setOpen(false);
  };

  const isHero = variant === 'hero';
  const pillClass = isHero
    ? 'flex flex-1 items-center gap-3 rounded-full border border-black/[0.06] bg-white/92 pl-4 pr-2 py-2 shadow-[0_12px_35px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#27282b]/88 dark:shadow-[0_18px_40px_-28px_rgba(0,0,0,0.85)]'
    : `glass-input flex flex-1 items-center gap-3 px-4 ${compact ? 'py-2.5' : 'py-3.5'}`;
  const inputClass = isHero
    ? 'flex-1 bg-transparent text-[16px] leading-snug text-slate-900 outline-none placeholder:text-slate-500 dark:text-slate-100 dark:placeholder:text-slate-400'
    : 'flex-1 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500';

  return (
    <div className={`relative mx-auto w-full ${isHero ? 'max-w-[680px]' : 'max-w-2xl'}`}>
      <form
        className={`flex w-full items-center ${isHero ? '' : 'gap-2'}`}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className={`${pillClass} ${!isHero ? '' : 'focus-within:ring-2 focus-within:ring-[var(--senko-orange)]/25 dark:focus-within:ring-orange-400/20'}`}>
          <Search
            className={`shrink-0 ${isHero ? 'h-[18px] w-[18px] text-slate-400 dark:text-slate-500' : 'h-5 w-5 text-slate-400 dark:text-slate-500'}`}
            aria-hidden
          />
          <input
            className={inputClass}
            placeholder={isHero ? 'Ask anything, find anything...' : 'Search the web, images, videos...'}
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
          {isHero && (
            <button
              type="submit"
              aria-label="Search"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-[var(--senko-orange)] to-orange-500 text-white shadow-[0_12px_24px_-14px_rgba(249,115,22,0.9)] transition hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!q.trim()}
            >
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
        {showSubmitButton && !isHero && (
          <button
            type="submit"
            className="rounded-full bg-gradient-to-r from-[var(--senko-orange)] to-orange-500 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-orange-500/25 transition hover:brightness-105 active:scale-[0.98]"
          >
            Search
          </button>
        )}
      </form>
      <AnimatePresence>
        {showDropdown && (
          <motion.ul
            id={listId}
            role="listbox"
            initial={{ opacity: 0, y: -4, scaleY: 0.97 }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            exit={{ opacity: 0, y: -4, scaleY: 0.97 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            style={{ transformOrigin: 'top' }}
            className={`absolute left-0 right-0 top-full z-40 overflow-hidden border backdrop-blur-2xl ${
              isHero
                ? 'rounded-[20px] mt-2 border-black/[0.07] bg-white/95 shadow-[0_20px_60px_-16px_rgba(15,23,42,0.35)] dark:border-white/[0.09] dark:bg-[#1c1e22]/96 dark:shadow-[0_24px_60px_-20px_rgba(0,0,0,0.85)]'
                : 'rounded-2xl mt-1.5 border-slate-200/80 bg-white/97 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.22)] dark:border-white/[0.08] dark:bg-[#18191d]/97 dark:shadow-[0_16px_48px_-16px_rgba(0,0,0,0.75)]'
            }`}
          >
            {/* Header row with loading indicator */}
            {suggestLoading && liveRows.length === 0 && (
              <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5 dark:border-white/[0.05]">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" aria-hidden />
                <span className="text-[11px] text-slate-400 dark:text-slate-500">Finding suggestions…</span>
              </div>
            )}

            {combined.map((c, idx) => {
              const i = idx;
              const isHistory = c.kind === 'history';
              const isActive = i === activeIdx;
              return (
                <li
                  key={`${c.kind}-${c.text}-${idx}`}
                  id={`opt-${i}`}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActiveIdx(i)}
                >
                  <button
                    type="button"
                    className={`group/row flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      isActive
                        ? 'bg-slate-100/90 dark:bg-white/[0.07]'
                        : 'hover:bg-slate-50 dark:hover:bg-white/[0.04]'
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setQ(c.text);
                      onSubmitSearch(c.text, activeTab);
                      setOpen(false);
                    }}
                  >
                    {isHistory ? (
                      <Clock className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
                    ) : (
                      <Search className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1 text-[14px] leading-snug">
                      <SuggestionLabel query={q} text={c.text} />
                    </span>
                    <ArrowUpRight
                      className={`h-4 w-4 shrink-0 text-slate-400 opacity-0 transition-opacity group-hover/row:opacity-100 dark:text-slate-500 ${isActive ? 'opacity-100' : ''}`}
                      aria-hidden
                    />
                  </button>
                </li>
              );
            })}

            {normalizedQuery.length >= 1 && suggestLoading && liveRows.length === 0 && recentRows.length === 0 && (
              <>
                {[70, 55, 80].map((w, k) => (
                  <div key={k} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="h-4 w-4 shrink-0 animate-pulse rounded bg-slate-200 dark:bg-white/10" />
                    <span
                      className="h-3.5 animate-pulse rounded bg-slate-200 dark:bg-white/10"
                      style={{ width: `${w}%` }}
                    />
                  </div>
                ))}
              </>
            )}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
