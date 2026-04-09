'use client';

import React, { useCallback, useRef } from 'react';
import Link from 'next/link';
import { prefetchUrl } from '@/lib/prefetch';

interface PrefetchLinkProps {
  href: string;
  as?: string;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  passHref?: boolean;
  prefetch?: boolean;
  locale?: string | false;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  children: React.ReactNode;
  className?: string;
  target?: string;
  rel?: string;
  [key: string]: unknown;
}

export default function PrefetchLink({
  href,
  as: asProp,
  replace,
  scroll,
  shallow,
  passHref,
  prefetch: prefetchProp = true,
  locale,
  onClick,
  children,
  className,
  target,
  rel,
  ...rest
}: PrefetchLinkProps) {
  const prefetchedRef = useRef(false);
  const handleMouseEnter = useCallback(() => {
    if (prefetchProp && !prefetchedRef.current) {
      prefetchedRef.current = true;
      prefetchUrl(href);
    }
  }, [href, prefetchProp]);

  return (
    <Link
      href={href}
      as={asProp}
      replace={replace}
      scroll={scroll}
      shallow={shallow}
      passHref={passHref}
      locale={locale}
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      className={className}
      target={target}
      rel={rel}
      {...rest}
    >
      {children}
    </Link>
  );
}