'use client';

import Image from 'next/image';
import { Globe } from 'lucide-react';
import { useState } from 'react';
import { faviconUrlForHost } from '@/lib/site';

interface SiteFaviconProps {
  hostname: string;
  size?: number;
  className?: string;
}

export default function SiteFavicon({ hostname, size = 28, className = '' }: SiteFaviconProps) {
  const [failed, setFailed] = useState(false);
  const src = faviconUrlForHost(hostname);
  if (!hostname || failed) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-md bg-black/5 dark:bg-white/10 ${className}`}
        style={{ width: size, height: size }}
      >
        <Globe className="text-senko-gray" style={{ width: size * 0.55, height: size * 0.55 }} aria-hidden />
      </span>
    );
  }
  return (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      className={`shrink-0 rounded-md bg-white object-contain ${className}`}
      unoptimized
      onError={() => setFailed(true)}
    />
  );
}
