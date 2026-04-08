import axios, { type AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import { EventEmitter } from 'node:events';
import type { SenkoConfig } from '@senko/shared';
import { CrawlQueue, RateLimiter, RobotsCache } from './politeness.js';
import type { ParsedPage } from './types.js';
import { shouldEnqueue } from './rules.js';

export interface CrawlState {
  depth: number;
  priority: number;
}

export class SenkoSpider extends EventEmitter {
  private readonly visited = new Set<string>();
  private readonly robots = new RobotsCache();
  private readonly queue = new CrawlQueue();
  private readonly rateLimiter: RateLimiter;
  private readonly domainCounts = new Map<string, number>();
  private stopped = false;

  constructor(
    private readonly config: SenkoConfig,
    private readonly userAgent: string,
  ) {
    super();
    this.rateLimiter = new RateLimiter(config.crawlDelayMs, this);
  }

  normalizeUrl(url: string, base: string): string {
    try {
      const u = new URL(url, base);
      u.hash = '';
      if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname) {
        u.hostname = u.hostname.toLowerCase();
      }
      return u.href;
    } catch {
      return '';
    }
  }

  extractLinks(html: string, baseUrl: string): string[] {
    const $ = cheerio.load(html);
    const out: string[] = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || href.startsWith('mailto:') || href.startsWith('javascript:')) return;
      const abs = this.normalizeUrl(href, baseUrl);
      if (abs && (abs.startsWith('http://') || abs.startsWith('https://'))) {
        out.push(abs);
      }
    });
    return out;
  }

  async isAllowed(url: string): Promise<boolean> {
    return this.robots.isAllowed(url, this.userAgent);
  }

  async fetchPage(url: string): Promise<ParsedPage> {
    const domain = new URL(url).hostname;
    await this.rateLimiter.throttle(domain);
    const res: AxiosResponse<string> = await axios.get<string>(url, {
      responseType: 'text',
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: (s) => s < 500,
      headers: {
        'User-Agent': this.userAgent,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      },
    });
    this.rateLimiter.registerResponse(domain, res.status);
    const contentType = String(res.headers['content-type'] ?? 'text/html');
    return {
      url,
      html: typeof res.data === 'string' ? res.data : String(res.data),
      statusCode: res.status,
      contentType,
      crawledAt: new Date(),
    };
  }

  async crawl(): Promise<void> {
    this.stopped = false;
    let pages = 0;
    const maxPages = this.config.maxPages;
    const maxDepth = this.config.maxDepth;

    const urlDepth = new Map<string, number>();
    for (const seed of this.config.seedUrls) {
      const n = this.normalizeUrl(seed, seed);
      if (!n) continue;
      if (!(await this.isAllowed(n))) continue;
      this.queue.enqueue(n, -1);
      urlDepth.set(n, 0);
    }

    while (!this.stopped && this.queue.size() > 0 && pages < maxPages) {
      const url = this.queue.dequeue();
      if (!url) break;
      if (this.visited.has(url)) continue;
      const depth = urlDepth.get(url) ?? 0;

      if (!(await this.isAllowed(url))) continue;

      this.visited.add(url);
      const host = new URL(url).hostname.replace(/^www\./, '');
      this.domainCounts.set(host, (this.domainCounts.get(host) ?? 0) + 1);

      let page: ParsedPage;
      try {
        page = await this.fetchPage(url);
      } catch (err) {
        this.emit('fetchError', { url, error: err });
        continue;
      }

      if (page.statusCode >= 400 || !page.contentType.toLowerCase().includes('text/html')) {
        this.emit('page', page);
        pages++;
        continue;
      }

      this.emit('page', page);
      pages++;

      if (depth < maxDepth) {
        const links = this.extractLinks(page.html, url);
        for (const link of links) {
          if (this.visited.has(link)) continue;
          if (!shouldEnqueue(link, this.domainCounts)) continue;
          if (!(await this.isAllowed(link))) continue;
          if (!urlDepth.has(link)) {
            urlDepth.set(link, depth + 1);
            const pr = 0;
            this.queue.enqueue(link, -pr);
          }
        }
      }
    }

    this.emit('done', { pages });
  }

  stop(): void {
    this.stopped = true;
  }
}
