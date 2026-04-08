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
    queue = new Bull<CrawlJobPayload>(senkoConfig.crawler.queueName, url);
  }
  return queue;
}
