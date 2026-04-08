'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';

/** Theme-based styles that must match server + first client paint (avoid hydration mismatch). */
export function useClientDark(): boolean {
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme } = useTheme();
  useEffect(() => setMounted(true), []);
  return mounted && resolvedTheme === 'dark';
}
