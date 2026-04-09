'use client';

import { useLayoutEffect, useState, useCallback } from 'react';
import type { SearchTab } from './history';

function normalizeSearchTab(raw: unknown): SearchTab {
  if (raw === 'web' || raw === 'image' || raw === 'video') return raw;
  if (raw === 'gif') return 'image';
  return 'web';
}

const COOKIE_NAME = 'senko-prefs';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; 

export interface UserPrefs {
  safeSearch: boolean;
  lastTab: SearchTab;
  theme: 'light' | 'dark' | 'system';
}

const defaultPrefs: UserPrefs = {
  safeSearch: true,
  lastTab: 'web',
  theme: 'system',
};

function parseCookie(): UserPrefs {
  if (typeof document === 'undefined') return defaultPrefs;
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
    if (match) {
      const parsed = JSON.parse(decodeURIComponent(match[1]!)) as Partial<UserPrefs>;
      return { ...defaultPrefs, ...parsed, lastTab: normalizeSearchTab(parsed.lastTab) };
    }
  } catch {}
  return defaultPrefs;
}

function setCookie(prefs: UserPrefs): void {
  if (typeof document === 'undefined') return;
  const encoded = encodeURIComponent(JSON.stringify(prefs));
  document.cookie = `${COOKIE_NAME}=${encoded}; max-age=${COOKIE_MAX_AGE}; path=/; SameSite=Lax`;
}

function parseLs(key: string): unknown {
  if (typeof window === 'undefined') return null;
  try {
    const v = localStorage.getItem(key);
    if (v == null) return null;
    return JSON.parse(v) as unknown;
  } catch {
    return null;
  }
}

/** `senko-safe-search` may be JSON booleans (from prefs) or legacy "0"/"1" strings. */
function parseLsSafeOverride(): boolean | undefined {
  if (typeof window === 'undefined') return undefined;
  const raw = localStorage.getItem('senko-safe-search');
  if (raw == null) return undefined;
  if (raw === '0') return false;
  if (raw === '1') return true;
  try {
    const j = JSON.parse(raw) as unknown;
    if (j === false) return false;
    if (j === true) return true;
  } catch {
    /* ignore */
  }
  return undefined;
}

function readStoragePrefs(): UserPrefs {
  if (typeof document === 'undefined') return defaultPrefs;
  const cookie = parseCookie();
  const lsSafe = parseLsSafeOverride();
  const lsTab = parseLs('senko-last-tab');
  const lsTheme = parseLs('senko-theme');
  return {
    safeSearch: lsSafe === false ? false : lsSafe === true ? true : cookie.safeSearch,
    lastTab: normalizeSearchTab(lsTab ?? cookie.lastTab),
    theme: (lsTheme as 'light' | 'dark' | 'system') || cookie.theme,
  };
}

/** First paint on /search?safe=0 must not use cookie default before React search params run. */
function applyUrlSafeOverride(base: UserPrefs): UserPrefs {
  if (typeof window === 'undefined') return base;
  try {
    const s = new URLSearchParams(window.location.search).get('safe');
    if (s === '0' || s === 'false') return { ...base, safeSearch: false };
    if (s === '1' || s === 'true') return { ...base, safeSearch: true };
  } catch {
    /* ignore */
  }
  return base;
}

function setLs(key: string, v: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

export function useUserPrefs(): [
  UserPrefs,
  (updates: Partial<UserPrefs>) => void,
  /** False until client has read cookie + localStorage (avoid first fetch with wrong safe mode). */
  prefsReady: boolean,
] {
  const [prefs, setPrefs] = useState<UserPrefs>(defaultPrefs);
  const [prefsReady, setPrefsReady] = useState(false);

  useLayoutEffect(() => {
    setPrefs(applyUrlSafeOverride(readStoragePrefs()));
    setPrefsReady(true);
  }, []);

  const update = useCallback((updates: Partial<UserPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...updates };
      setCookie(next);
      if (updates.safeSearch !== undefined) {
        setLs('senko-safe-search', updates.safeSearch);
      }
      if (updates.lastTab !== undefined) {
        setLs('senko-last-tab', updates.lastTab);
      }
      if (updates.theme !== undefined) {
        setLs('senko-theme', updates.theme);
      }
      return next;
    });
  }, []);

  return [prefs, update, prefsReady];
}

export function getSafeSearchFromCookie(): boolean {
  return parseCookie().safeSearch;
}