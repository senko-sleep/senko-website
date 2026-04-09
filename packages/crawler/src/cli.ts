import { senkoConfig } from '@senko/shared';
import { SenkoSpider } from './spider.js';
import { resolveSeedUrlList } from './seeds.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--print-seeds')) {
    const seeds = resolveSeedUrlList();
    console.log(JSON.stringify(seeds, null, 2));
    console.error(`(${seeds.length} from SENKO_SEED_URLS — no bundled defaults)`);
    return;
  }

  if (argv.includes('--enqueue')) {
    const base = process.env.SENKO_API_URL ?? `http://127.0.0.1:${senkoConfig.api.port}`;
    const seeds = resolveSeedUrlList();
    if (seeds.length === 0) {
      console.error(
        'No seeds: set SENKO_SEED_URLS in .env (comma-separated https URLs), or POST /api/crawl with a seedUrls array.',
      );
      process.exitCode = 1;
      return;
    }
    const maxSeeds = senkoConfig.crawler.cliMaxSeeds;
    const body = {
      seedUrls: seeds.slice(0, maxSeeds),
      maxDepth: senkoConfig.crawler.cliMaxDepth,
      maxPages: senkoConfig.crawler.cliMaxPages,
    };
    const res = await fetch(`${base.replace(/\/$/, '')}/api/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error('Enqueue failed:', res.status, text);
      process.exitCode = 1;
      return;
    }
    console.log('Enqueued crawl job:', text);
    console.error(
      `Seeds in this job: ${body.seedUrls.length} (maxDepth=${body.maxDepth}, maxPages=${body.maxPages}). Ensure "npm run worker" is running.`,
    );
    return;
  }

  /** Dry-run spider only (no database writes). Use --enqueue + worker for real indexing. */
  const seeds = resolveSeedUrlList().slice(0, Math.min(8, senkoConfig.crawler.cliMaxSeeds));
  if (seeds.length === 0) {
    console.error(
      'No seeds: set SENKO_SEED_URLS, or pass seedUrls when calling POST /api/crawl. Dry-run needs the same.',
    );
    process.exitCode = 1;
    return;
  }
  const spider = new SenkoSpider(
    {
      seedUrls: seeds,
      maxDepth: 1,
      maxPages: 24,
      crawlDelayMs: senkoConfig.crawler.crawlDelayMs,
    },
    senkoConfig.crawler.userAgent,
  );
  console.error(
    '[dry-run] crawling without indexing — for real results run: npm run crawl:enqueue (API + worker must be up)',
  );
  spider.on('page', (p) => console.log('page', p.url));
  spider.on('error', (e) => console.error('err', e));
  spider.on('done', (x) => console.log('done', x));
  await spider.crawl();
}

void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
