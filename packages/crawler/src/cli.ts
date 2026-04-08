import { senkoConfig } from '@senko/shared';
import { SenkoSpider } from './spider.js';
import { DEFAULT_SEEDS } from './seeds.js';

async function main(): Promise<void> {
  const seeds = DEFAULT_SEEDS.map((s) => s.url);
  const spider = new SenkoSpider(
    {
      seedUrls: seeds.slice(0, 5),
      maxDepth: 1,
      maxPages: 10,
      crawlDelayMs: senkoConfig.crawler.crawlDelayMs,
    },
    senkoConfig.crawler.userAgent,
  );
  spider.on('page', (p) => console.log('page', p.url));
  spider.on('error', (e) => console.error('err', e));
  spider.on('done', (x) => console.log('done', x));
  await spider.crawl();
}

main().catch(console.error);
