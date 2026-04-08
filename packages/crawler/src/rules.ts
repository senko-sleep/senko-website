export interface CrawlRule {
  domain: string;
  maxPagesPerDomain: number;
  allowedPathPatterns: RegExp[];
  blockedPathPatterns: RegExp[];
  extractMedia: boolean;
}

export const BLOCKED_DOMAINS = new Set<string>([
  'facebook.com',
  'instagram.com',
  'login.microsoftonline.com',
  'accounts.google.com',
  'adult-example.invalid',
]);

const defaultRule: CrawlRule = {
  domain: '*',
  maxPagesPerDomain: 100,
  allowedPathPatterns: [/.*/],
  blockedPathPatterns: [],
  extractMedia: true,
};

const rulesByDomain = new Map<string, CrawlRule>([
  [
    'youtube.com',
    {
      domain: 'youtube.com',
      maxPagesPerDomain: 200,
      allowedPathPatterns: [/^\/watch/],
      blockedPathPatterns: [],
      extractMedia: true,
    },
  ],
  [
    'youtu.be',
    {
      domain: 'youtu.be',
      maxPagesPerDomain: 200,
      allowedPathPatterns: [/.*/],
      blockedPathPatterns: [],
      extractMedia: true,
    },
  ],
  [
    'imgur.com',
    {
      domain: 'imgur.com',
      maxPagesPerDomain: 500,
      allowedPathPatterns: [/^\/gallery\//, /^\/a\//],
      blockedPathPatterns: [],
      extractMedia: true,
    },
  ],
  [
    'giphy.com',
    {
      domain: 'giphy.com',
      maxPagesPerDomain: 1000,
      allowedPathPatterns: [/.*/],
      blockedPathPatterns: [],
      extractMedia: true,
    },
  ],
  [
    'wikipedia.org',
    {
      domain: 'wikipedia.org',
      maxPagesPerDomain: 5000,
      allowedPathPatterns: [/^\/wiki\//],
      blockedPathPatterns: [],
      extractMedia: true,
    },
  ],
  [
    'reddit.com',
    {
      domain: 'reddit.com',
      maxPagesPerDomain: 300,
      allowedPathPatterns: [/.*/],
      blockedPathPatterns: [/^\/user\//, /^\/u\//],
      extractMedia: true,
    },
  ],
]);

export function getRuleForHost(host: string): CrawlRule {
  const h = host.replace(/^www\./, '');
  return rulesByDomain.get(h) ?? { ...defaultRule, domain: h };
}

export function shouldEnqueue(urlStr: string, domainCounts: Map<string, number>): boolean {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    return false;
  }
  const host = u.hostname.replace(/^www\./, '');
  if (BLOCKED_DOMAINS.has(host)) return false;
  const rule = getRuleForHost(host);
  const count = domainCounts.get(host) ?? 0;
  if (count >= rule.maxPagesPerDomain) return false;
  const path = u.pathname || '/';
  if (rule.blockedPathPatterns.some((p) => p.test(path))) return false;
  if (!rule.allowedPathPatterns.some((p) => p.test(path))) return false;
  return true;
}
