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
8. **Open-web search (recommended for a “search the whole internet” experience):** Get a key from [Brave Search API](https://brave.com/search/api/) and set `BRAVE_SEARCH_API_KEY` in `.env`. Optionally set `WEB_SEARCH_PROVIDER` to `brave` (default with key), `local` (crawler index only), or `hybrid` (Brave web + your crawl). Results are **not** hardcoded to any site list—they come from Brave’s index. GIF search still uses your local crawl.
9. **Index live pages (optional, for your own crawl mirror):** Set `SENKO_SEED_URLS` or `POST /api/crawl` with `seedUrls`. Then `npm run crawl:enqueue` with `npm run worker` running. Tune depth/pages with `CRAWL_CLI_*`. `npm run crawl` is a dry-run spider only.
10. **Reset sidebar “trending”** (no `redis-cli` on Windows): `npm run clear:trending`.

Makefile shortcuts (if `make` is available): `make dev`, `make build`, `make crawl`, `make index`, `make db-migrate`.

## API reference

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api/search?q=&type=web|image|video|gif|all|news&page=&safe=0|1` | Search — with `BRAVE_SEARCH_API_KEY`, web/image/video/news use Brave’s open-web index (unless `WEB_SEARCH_PROVIDER=local`) |
| GET | `/api/suggest?q=` | Top 5 autocomplete terms |
| GET | `/api/stats` | Index counts |
| GET | `/api/trending` | Popular recent searches (Redis); if empty, **top terms from your indexed keywords** (not a fixed list) |
| GET | `/api/health` | Health + uptime |
| POST | `/api/crawl` | Body: `{ seedUrls?, maxDepth?, maxPages? }` — must end up with non-empty seeds: either pass `seedUrls` or set `SENKO_SEED_URLS` in the environment |
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
