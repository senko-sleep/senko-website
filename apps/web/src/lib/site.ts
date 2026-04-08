export function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
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
