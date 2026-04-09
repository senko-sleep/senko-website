/**
 * Senko does not insert synthetic Page/Image/Video rows.
 * The index is filled only by the crawl worker processing real HTTP fetches.
 *
 * Typical local flow:
 *   1. docker compose up -d postgres redis
 *   2. npm run db:migrate && npm run dev
 *   3. npm run worker
 *   4. Set SENKO_SEED_URLS in .env (live URLs to start from), then npm run crawl:enqueue
 *      — or POST /api/crawl with { "seedUrls": ["https://..."] } (nothing is bundled in-repo).
 *
 * adult / sensitive sites: only enable with Safe search off and your own compliance review;
 * Senko does not ship third-party seed lists for those categories.
 */
console.log(`
No artificial DB seed — index comes from the crawler.

Next steps:
  • Still see senko.local? Run: npm run purge:demo-hosts
  • Start API + web + worker
  • Set SENKO_SEED_URLS (or POST /api/crawl with seedUrls), then: npm run crawl:enqueue

See scripts/seed-smoke-data.mjs header for details.
`);
