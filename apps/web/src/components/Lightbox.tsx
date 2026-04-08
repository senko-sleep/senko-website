'use client';

import React, { useEffect, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
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
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="relative max-h-[90vh] max-w-[90vw]"
          initial={{ scale: 0.92, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.92, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute -right-2 -top-2 z-10 rounded-full bg-white/90 p-2 text-senko-dark shadow"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
          <div className="relative h-auto max-h-[80vh] w-auto overflow-hidden rounded-lg">
            <Image
              src={item.url}
              alt={item.alt ?? item.title ?? 'media'}
              width={1200}
              height={800}
              className="max-h-[80vh] w-auto object-contain"
              unoptimized
            />
          </div>
          <div className="mt-4 flex items-center justify-between gap-4">
            <button
              type="button"
              className="rounded-full bg-white/10 p-2 text-white"
              onClick={() => go(-1)}
            >
              <ChevronLeft />
            </button>
            <a
              href={item.pageUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--senko-orange)] underline"
            >
              View source page →
            </a>
            <button
              type="button"
              className="rounded-full bg-white/10 p-2 text-white"
              onClick={() => go(1)}
            >
              <ChevronRight />
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
