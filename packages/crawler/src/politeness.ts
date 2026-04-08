import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const robotsParser = require('robots-parser') as (
  url: string,
  robotstxt: string,
) => { isAllowed(path: string, ua: string): boolean };
import type { IncomingMessage } from 'node:http';

const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;

export interface RobotsTxtRules {
  isAllowed: (path: string, userAgent: string) => boolean;
  fetchedAt: number;
}

export class RobotsCache {
  private readonly cache = new Map<string, RobotsTxtRules>();

  async isAllowed(url: string, userAgent: string): Promise<boolean> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    const origin = `${parsed.protocol}//${parsed.host}`;
    const path = parsed.pathname || '/';
    const rules = await this.getRules(origin, userAgent);
    return rules.isAllowed(path, userAgent);
  }

  private async getRules(origin: string, userAgent: string): Promise<RobotsTxtRules> {
    const now = Date.now();
    const cached = this.cache.get(origin);
    if (cached && now - cached.fetchedAt < ROBOTS_TTL_MS) {
      return cached;
    }
    const robotsUrl = `${origin}/robots.txt`;
    let text = '';
    try {
      const res = await fetch(robotsUrl, {
        headers: { 'User-Agent': userAgent },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        text = await res.text();
      }
    } catch {
      text = '';
    }
    const parser = robotsParser(robotsUrl, text);
    const rules: RobotsTxtRules = {
      isAllowed: (path: string, ua: string) => parser.isAllowed(path, ua),
      fetchedAt: now,
    };
    this.cache.set(origin, rules);
    return rules;
  }
}

export class RateLimiter {
  private readonly lastRequest = new Map<string, number>();
  private readonly backoff = new Map<string, number>();

  constructor(
    private readonly defaultDelayMs: number,
    private readonly emitter?: EventEmitter,
  ) {}

  async throttle(domain: string): Promise<void> {
    const extra = this.backoff.get(domain) ?? 0;
    const delay = Math.max(this.defaultDelayMs, extra);
    const last = this.lastRequest.get(domain) ?? 0;
    const wait = Math.max(0, delay - (Date.now() - last));
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    this.lastRequest.set(domain, Date.now());
  }

  registerResponse(domain: string, statusCode: number): void {
    if (statusCode === 429 || statusCode === 503) {
      const attempt = (this.backoff.get(domain) ?? 0) + 1;
      const ms = Math.min(2 ** attempt * 1000, 120_000);
      this.backoff.set(domain, ms);
      this.emitter?.emit('rateLimit', { domain, statusCode, waitMs: ms });
    } else if (statusCode < 400) {
      this.backoff.set(domain, 0);
    }
  }

  responseHook(domain: string, res: IncomingMessage | { statusCode?: number }): void {
    const code = res.statusCode ?? 0;
    if (code) this.registerResponse(domain, code);
  }
}

type HeapItem = { url: string; priority: number };

export class CrawlQueue {
  private heap: HeapItem[] = [];

  private siftUp(i: number): void {
    const h = this.heap;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[i]!.priority >= h[p]!.priority) break;
      [h[i], h[p]] = [h[p]!, h[i]!];
      i = p;
    }
  }

  private siftDown(i: number): void {
    const h = this.heap;
    const n = h.length;
    for (;;) {
      let smallest = i;
      const l = i * 2 + 1;
      const r = l + 1;
      if (l < n && h[l]!.priority < h[smallest]!.priority) smallest = l;
      if (r < n && h[r]!.priority < h[smallest]!.priority) smallest = r;
      if (smallest === i) break;
      [h[i], h[smallest]] = [h[smallest]!, h[i]!];
      i = smallest;
    }
  }

  enqueue(url: string, priority: number): void {
    this.heap.push({ url, priority });
    this.siftUp(this.heap.length - 1);
  }

  dequeue(): string | undefined {
    const h = this.heap;
    if (h.length === 0) return undefined;
    const top = h[0]!.url;
    const last = h.pop()!;
    if (h.length > 0) {
      h[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  size(): number {
    return this.heap.length;
  }
}
