/**
 * Removes index rows from the legacy demo seeder (hosts like senko.local, video.senko.local).
 * After purging, run a real crawl (SENKO_SEED_URLS + worker + crawl:enqueue) so results are live URLs.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function loadDotEnv() {
  const p = resolve(repoRoot, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadDotEnv();

function dbTargetHint(raw) {
  if (!raw?.trim()) {
    return 'DATABASE_URL missing — add it to .env in the repo root (postgresql://…)';
  }
  try {
    const u = new URL(raw.replace(/^postgresql:/i, 'http:'));
    const user = u.username ? `${u.username}@` : '';
    return `${user}${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

const prisma = new PrismaClient();

const demoHost = { contains: 'senko.local', mode: 'insensitive' };

async function main() {
  const target = dbTargetHint(process.env.DATABASE_URL);
  console.log('Using database:', target);

  const [totalPages, demoPageCount, demoImageCount] = await Promise.all([
    prisma.page.count(),
    prisma.page.count({ where: { url: demoHost } }),
    prisma.image.count({ where: { OR: [{ url: demoHost }, { pageUrl: demoHost }] } }),
  ]);
  console.log('Before purge:', {
    totalPages,
    pagesWithDemoHost: demoPageCount,
    imagesWithDemoHost: demoImageCount,
  });

  const [gifs, vids, imgs, pages] = await Promise.all([
    prisma.gif.deleteMany({
      where: { OR: [{ url: demoHost }, { pageUrl: demoHost }] },
    }),
    prisma.video.deleteMany({
      where: { OR: [{ url: demoHost }, { pageUrl: demoHost }, { thumbnailUrl: demoHost }] },
    }),
    prisma.image.deleteMany({
      where: { OR: [{ url: demoHost }, { pageUrl: demoHost }] },
    }),
    prisma.page.deleteMany({ where: { url: demoHost } }),
  ]);

  console.log('Removed demo-host rows:', {
    pages: pages.count,
    images: imgs.count,
    videos: vids.count,
    gifs: gifs.count,
  });

  const removed = pages.count + imgs.count + vids.count + gifs.count;
  if (removed === 0) {
    if (totalPages === 0 && !process.env.DATABASE_URL?.trim()) {
      console.log('\nTip: .env was not found or DATABASE_URL is unset — Prisma may be using a wrong default.');
    } else if (demoPageCount === 0 && demoImageCount === 0) {
      console.log('\nNothing with senko.local in this database — already clean or demo lived in another Postgres.');
      console.log('If the app still shows old results, your API may use a different DATABASE_URL (e.g. Docker vs localhost).');
    }
  } else {
    console.log('\nNext: set SENKO_SEED_URLS, run npm run worker, then npm run crawl:enqueue to index the real web.');
    console.log('If "Trending" still shows old terms: npm run clear:trending (no redis-cli needed).');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
