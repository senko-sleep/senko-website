/**
 * Parallel crawling uses Bull (Redis) with configurable concurrency.
 * See apps/api crawl worker — worker_threads are not required when Bull workers scale horizontally.
 */
export const CRAWL_QUEUE_NAME = 'senko:crawl';

export interface WorkerPoolConfig {
  maxWorkers: number;
  queueName: string;
}
