'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { useTheme } from 'next-themes';
import { useUserPrefs, type UserPrefs } from '@/lib/prefs';
import type { SearchTab } from '@/lib/history';

interface PrefsContextValue {
  prefs: UserPrefs;
  updatePrefs: (updates: Partial<UserPrefs>) => void;
  /** True after cookie + localStorage have been applied (client only). */
  prefsReady: boolean;
  safeSearch: boolean;
  setSafeSearch: (v: boolean) => void;
  activeTab: SearchTab;
  setActiveTab: (t: SearchTab) => void;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, updatePrefs, prefsReady] = useUserPrefs();
  const { setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (mounted && prefs.theme !== 'system') {
      setTheme(prefs.theme);
    }
  }, [prefs.theme, setTheme, mounted]);

  const setSafeSearch = useCallback((v: boolean) => updatePrefs({ safeSearch: v }), [updatePrefs]);
  const setActiveTab = useCallback((t: SearchTab) => updatePrefs({ lastTab: t }), [updatePrefs]);

  const value = useMemo(
    () => ({
      prefs,
      updatePrefs,
      prefsReady,
      safeSearch: prefs.safeSearch,
      setSafeSearch,
      activeTab: prefs.lastTab,
      setActiveTab,
    }),
    [prefs, updatePrefs, prefsReady, setSafeSearch, setActiveTab],
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs must be used within PrefsProvider');
  return ctx;
}

export function useCookieSafeSearch(): boolean {
  const { prefs } = usePrefs();
  return prefs.safeSearch;
}