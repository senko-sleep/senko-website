'use client';

import React, { useEffect, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import Image from 'next/image';

export interface MediaItem {
  url: string;
  pageUrl: string;
  title?: string | null;
  alt?: string | null;
}

interface LightboxProps {
  items: MediaItem[];
  initialIndex: number;
  onClose: () => void;
}

export default function Lightbox({ items, initialIndex, onClose }: LightboxProps) {
  const [index, setIndex] = useState(initialIndex);

  const go = useCallback(
    (d: number) => {
      setIndex((i) => {
        const n = i + d;
        if (n < 0) return items.length - 1;
        if (n >= items.length) return 0;
        return n;
      });
    },
    [items.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, go]);

  const item = items[index];
  if (!item) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xl"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        role="presentation"
      >
        <motion.div
          className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[1.25rem] border border-white/15 bg-white/75 shadow-[0_25px_80px_-12px_rgba(0,0,0,0.45)] ring-1 ring-black/5 dark:border-white/10 dark:bg-slate-900/85 dark:shadow-[0_25px_80px_-12px_rgba(0,0,0,0.75)] dark:ring-white/10"
          initial={{ scale: 0.96, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.96, opacity: 0, y: 12 }}
          transition={{ type: 'spring', damping: 26, stiffness: 320 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="absolute right-3 top-3 z-10 flex gap-2">
            <a
              href={item.pageUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/90 px-3.5 text-sm font-medium text-slate-800 shadow-sm backdrop-blur-md transition hover:bg-white dark:border-white/10 dark:bg-white/10 dark:text-slate-100 dark:hover:bg-white/15"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="h-4 w-4 opacity-80" />
              Source
            </a>
            <button
              type="button"
              aria-label="Close"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200/80 bg-white/90 text-slate-800 shadow-sm backdrop-blur-md transition hover:bg-white dark:border-white/10 dark:bg-white/10 dark:text-slate-100 dark:hover:bg-white/15"
              onClick={onClose}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex max-h-[calc(92vh-5.5rem)] min-h-0 items-center justify-center overflow-auto bg-slate-950/[0.03] px-4 pb-2 pt-14 dark:bg-black/25 sm:px-8 sm:pt-16">
            <div className="relative w-full">
              <Image
                src={item.url}
                alt={item.alt ?? item.title ?? 'media'}
                width={1400}
                height={1050}
                className="mx-auto max-h-[72vh] w-auto max-w-full rounded-lg object-contain shadow-inner"
                unoptimized
              />
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-between gap-4 border-t border-slate-200/60 bg-white/50 px-4 py-3 backdrop-blur-md dark:border-white/[0.08] dark:bg-slate-950/50 sm:px-5">
            <button
              type="button"
              aria-label="Previous"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200/80 bg-white/80 text-slate-800 transition hover:bg-white dark:border-white/10 dark:bg-white/10 dark:text-slate-100 dark:hover:bg-white/15"
              onClick={() => go(-1)}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <p className="min-w-0 truncate text-center text-xs text-slate-500 tabular-nums dark:text-slate-400">
              {index + 1} / {items.length}
            </p>
            <button
              type="button"
              aria-label="Next"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200/80 bg-white/80 text-slate-800 transition hover:bg-white dark:border-white/10 dark:bg-white/10 dark:text-slate-100 dark:hover:bg-white/15"
              onClick={() => go(1)}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
