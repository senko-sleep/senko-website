export function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Single-line URL for UI (hostname + path + query), truncated. Full URL stays on `title`. */
export function displayUrlCompact(url: string, maxLen = 72): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname === '/' ? '' : u.pathname;
    const qs = u.search;
    let s = host + path + qs;
    if (s.length > maxLen) s = s.slice(0, Math.max(0, maxLen - 1)) + '…';
    return s;
  } catch {
    return url.length > maxLen ? url.slice(0, Math.max(0, maxLen - 1)) + '…' : url;
  }
}

export function siteTitleFromHostname(host: string): string {
  if (!host) return '';
  const base = host.split('.')[0] ?? host;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Google-hosted favicon service (works for any public domain). */
export function faviconUrlForHost(hostname: string): string {
  const h = hostname.replace(/^www\./, '');
  return `https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(h)}`;
}

export function faviconUrlForPageUrl(pageUrl: string): string {
  const h = hostnameFromUrl(pageUrl);
  return faviconUrlForHost(h);
}
