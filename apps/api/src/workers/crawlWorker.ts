import { senkoConfig } from '@senko/shared';
import { prisma } from '@senko/db';
import { SenkoSpider, MediaDetector } from '@senko/crawler';
import {
  TextIndexer,
  ImageIndexer,
  VideoIndexer,
  GifIndexer,
  persistTextIndex,
  persistOutboundLinks,
} from '@senko/indexer';
import type { CrawledPage } from '@senko/shared';
import { getCrawlQueue, type CrawlJobPayload } from '../queue.js';

const crawlQueue = getCrawlQueue();
if (!crawlQueue) {
  console.error(
    'REDIS_URL is not set. The crawl worker requires a Redis protocol URL (e.g. rediss:// from Upstash Redis).',
  );
  process.exit(1);
}
const queue = crawlQueue;

const textIndexer = new TextIndexer();
const mediaDetector = new MediaDetector();
const imageIndexer = new ImageIndexer();
const videoIndexer = new VideoIndexer();
const gifIndexer = new GifIndexer();

queue.process(senkoConfig.crawler.maxWorkers, async (job) => {
  const { jobId, seedUrls, maxDepth, maxPages } = job.data as CrawlJobPayload;

  await prisma.crawlJob.update({
    where: { id: jobId },
    data: { status: 'running' },
  });

  const spider = new SenkoSpider(
    {
      seedUrls,
      maxDepth,
      maxPages,
      crawlDelayMs: senkoConfig.crawler.crawlDelayMs,
    },
    senkoConfig.crawler.userAgent,
  );

  spider.on('page', async (page) => {
    try {
      const crawled: CrawledPage = {
        url: page.url,
        html: page.html,
        statusCode: page.statusCode,
        crawledAt: page.crawledAt,
        contentType: page.contentType,
      };
      const text = await textIndexer.processPage(crawled);
      await persistTextIndex(text);
      const media = mediaDetector.detect(page);
      await imageIndexer.processImages(media.images, page.url);
      await videoIndexer.processVideos(media.videos, page.url);
      await gifIndexer.processGifs(media.gifs, page.url);

      const links = spider.extractLinks(page.html, page.url);
      await persistOutboundLinks(page.url, links);

      await prisma.crawlJob.update({
        where: { id: jobId },
        data: { pagesFound: { increment: 1 } },
      });
    } catch {
      await prisma.crawlJob.update({
        where: { id: jobId },
        data: { errors: { increment: 1 } },
      });
    }
  });

  try {
    await spider.crawl();
    await prisma.crawlJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        finishedAt: new Date(),
      },
    });
  } catch {
    await prisma.crawlJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        errors: { increment: 1 },
      },
    });
    throw new Error('Crawl failed');
  }
});

queue.on('failed', async (job, err) => {
  const data = job?.data as CrawlJobPayload | undefined;
  if (data?.jobId) {
    await prisma.crawlJob.update({
      where: { id: data.jobId },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        errors: { increment: 1 },
      },
    });
  }
  console.error('Crawl job failed', err);
});

async function shutdown(): Promise<void> {
  await queue.close();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});

console.log('Crawl worker listening', senkoConfig.crawler.queueName);
