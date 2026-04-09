import Bull from 'bull';
import { senkoConfig } from '@senko/shared';

export interface CrawlJobPayload {
  jobId: string;
  seedUrls: string[];
  maxDepth: number;
  maxPages: number;
}

let queue: Bull.Queue<CrawlJobPayload> | null = null;

export function getCrawlQueue(): Bull.Queue<CrawlJobPayload> | null {
  const url = senkoConfig.redis.url?.trim();
  if (!url) return null;
  if (!queue) {
    try {
      queue = new Bull<CrawlJobPayload>(senkoConfig.crawler.queueName, url);
      queue.on('error', (err) => {
        console.warn('[senko] Bull queue error, crawl features disabled:', err.message);
        queue = null;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.warn('[senko] Failed to create Bull queue, crawl features disabled:', msg);
      return null;
    }
  }
  return queue;
}
