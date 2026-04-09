'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/** Thin top bar when the URL changes (Next has no built-in route progress). */
export default function RouteLoadingIndicator() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [on, setOn] = useState(false);
  const prev = useRef<string | null>(null);

  useEffect(() => {
    const key = `${pathname}?${searchParams.toString()}`;
    if (prev.current === null) {
      prev.current = key;
      return;
    }
    if (prev.current !== key) {
      prev.current = key;
      setOn(true);
      const t = window.setTimeout(() => setOn(false), 700);
      return () => window.clearTimeout(t);
    }
  }, [pathname, searchParams]);

  if (!on) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-1 overflow-hidden bg-orange-500/15"
      aria-hidden
    >
      <div className="senko-route-progress h-full w-2/5 bg-[var(--senko-orange)] shadow-[0_0_12px_rgba(255,107,43,0.45)]" />
    </div>
  );
}
