'use client';

import { useRouter } from 'next/navigation';

export function prefetchUrl(url: string): void {
  if (typeof window === 'undefined') return;
  try {
    const router = (window as unknown as { __NEXT_ROUTER?: { prefetch: (path: string) => void } }).__NEXT_ROUTER;
    if (router?.prefetch) {
      router.prefetch(url);
    }
  } catch {}
}