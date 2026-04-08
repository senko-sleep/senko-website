# Senko Search

**Quick as a fox, sharp as a search.** A multi-type search engine (web, images, videos, GIFs, news) with a Node.js crawler, PostgreSQL + Prisma, Redis caching and Bull queues, and a Next.js 14 UI. Icon: animated fox tail. Language: TypeScript end-to-end.

## Features

- Web, image, video, GIF, and news-oriented search (news uses domain filtering + freshness)
- Axios + Cheerio crawler with robots.txt cache, per-domain rate limiting, and priority queue
- Media extraction (images, video embeds, GIFs) and Prisma-backed indexes
- Full-text search in PostgreSQL (`tsvector` / `plainto_tsquery`) plus composite ranking heuristics
- PageRank job (scheduled via `node-cron`) and autocomplete from keyword index
- Express API with Zod validation, Helmet, CORS, rate limits, Bull crawl workers
- Next.js App Router UI: homepage, results, lightbox, debounced suggest, safe search, dark mode, trending (Redis ZSET), local history

## Tech stack

| Layer    | Stack                                      |
| -------- | ------------------------------------------ |
| Frontend | Next.js 14, React 18, Tailwind, Framer Motion, SWR |
| API      | Express, Zod, Bull, ioredis, Helmet        |
| Database | PostgreSQL 16, Prisma                      |
| Cache/Q  | Redis 7, Bull                              |
| Crawler  | Axios, Cheerio, robots-parser              |

## Getting started

**Prerequisites:** Node.js 20+, npm, Docker (for Postgres + Redis).

1. Clone the repository and `cd` into it.
2. Copy environment: `cp .env.example .env` and adjust secrets and URLs. **Redis vs QStash:** `REDIS_URL` must be a Redis protocol URL (TLS `rediss://` from [Upstash Redis](https://upstash.com/) works with Bull and the crawl worker). [QStash](https://upstash.com/docs/qstash) is HTTP-based and is **not** a drop-in for `REDIS_URL`; optional env vars are stored for future HTTP-triggered workers. For REST-only cache without TCP, set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from the Upstash Redis dashboard.
3. Start databases: `docker compose up -d postgres redis`
4. Install dependencies: `npm install`
5. Generate Prisma client and apply migrations:
   - `npm run db:generate`
   - `npm run db:migrate` (requires `DATABASE_URL` pointing at your Postgres)
6. Run app (API + web): `npm run dev`
7. In another terminal, run the crawl worker so queued jobs execute: `npm run worker`
8. Optional: `npm run crawl` runs a small local crawl CLI (uses default seeds; keep limits low).

Makefile shortcuts (if `make` is available): `make dev`, `make build`, `make crawl`, `make index`, `make db-migrate`.

## API reference

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api/search?q=&type=web|image|video|gif|all|news&page=&safe=0|1` | Search |
| GET | `/api/suggest?q=` | Top 5 autocomplete terms |
| GET | `/api/stats` | Index counts |
| GET | `/api/trending` | Trending queries (Redis) |
| GET | `/api/health` | Health + uptime |
| POST | `/api/crawl` | Body: `{ seedUrls[], maxDepth?, maxPages? }` — enqueue crawl |
| GET | `/api/crawl/:jobId/status` | Crawl job status |

Base URL for the API defaults to `http://localhost:4000`. The web app uses `NEXT_PUBLIC_API_URL`.

## Architecture (ASCII)

```
                    +------------------+
                    |   Next.js :3000  |
                    +--------+---------+
                             |
                             v
                    +------------------+
                    |  Express :4000   |
        +-----------+--------+---------+-----------+
        |                    |                     |
        v                    v                     v
 +-------------+      +-------------+      +-------------+
 | PostgreSQL |      |   Redis     |      | Bull worker|
 |  (Prisma)  |      | cache/queue |      | crawl jobs   |
 +-------------+      +-------------+      +------+------+
                                                   |
                                                   v
                                            +-------------+
                                            | SenkoSpider |
                                            +-------------+
```

## Contributing

Issues and PRs are welcome. Please keep TypeScript `strict`, match existing formatting, and avoid unrelated refactors in a single change.

## Fox

Happy searching — powered by curiosity.
