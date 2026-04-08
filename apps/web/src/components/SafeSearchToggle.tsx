'use client';

import { useEffect, useState } from 'react';

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
}

export default function SafeSearchToggle({ safe, onChange }: Props) {
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
