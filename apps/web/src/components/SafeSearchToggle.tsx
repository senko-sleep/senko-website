'use client';

import { useEffect, useState } from 'react';
import { Shield } from 'lucide-react';

const KEY = 'senko-safe-search';

export function useSafeSearch(): [boolean, (v: boolean) => void] {
  const [safe, setSafeState] = useState(true);
  useEffect(() => {
    const v = localStorage.getItem(KEY);
    if (v === '0') setSafeState(false);
  }, []);
  const setSafe = (v: boolean) => {
    setSafeState(v);
    localStorage.setItem(KEY, v ? '1' : '0');
  };
  return [safe, setSafe];
}

interface Props {
  safe: boolean;
  onChange: (v: boolean) => void;
  /** Minimal icon-only control for sparse headers */
  compact?: boolean;
}

export default function SafeSearchToggle({ safe, onChange, compact = false }: Props) {
  if (compact) {
    return (
      <button
        type="button"
        aria-label={safe ? 'Safe search on' : 'Safe search off'}
        aria-pressed={safe}
        className="rounded-full border border-black/[0.06] bg-white/70 p-2 text-slate-500 shadow-sm backdrop-blur-md transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:hover:bg-white/10"
        onClick={() => onChange(!safe)}
      >
        <Shield className={`h-5 w-5 ${safe ? 'text-emerald-600 dark:text-emerald-400' : ''}`} aria-hidden />
      </button>
    );
  }
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-full border border-white/50 bg-white/40 px-3 py-2 text-xs font-medium text-slate-600 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/50 dark:text-slate-300">
      <input
        type="checkbox"
        className="accent-[var(--senko-orange)]"
        checked={safe}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>Safe {safe ? 'on' : 'off'}</span>
    </label>
  );
}
