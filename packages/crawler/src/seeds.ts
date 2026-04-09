import { senkoConfig } from '@senko/shared';

/**
 * Live crawl entry points only — parsed from `SENKO_SEED_URLS`.
 * There is no bundled list of sites; indexing always reflects URLs you (or your UI) supply,
 * then whatever the spider discovers from those pages on the public web.
 */
export function resolveSeedUrlList(): string[] {
  const raw = senkoConfig.crawler.seedUrlsEnv?.trim();
  if (!raw) return [];
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((u) => {
      if (!u.length) return false;
      try {
        const parsed = new URL(u);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    });
}
