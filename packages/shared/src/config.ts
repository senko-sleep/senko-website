import { config as loadEnv } from 'dotenv';
import { z } from 'zod';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findEnvPath(): string | undefined {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '..', '.env'),
    resolve(process.cwd(), '..', '..', '.env'),
    resolve(__dirname, '..', '..', '..', '.env'),
  ];
  return candidates.find((p) => existsSync(p));
}

const envPath = findEnvPath();
if (envPath) {
  loadEnv({ path: envPath });
} else {
  loadEnv();
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  /** TCP/TLS Redis URL for Bull + ioredis (e.g. `rediss://...` from Upstash Redis — not the QStash HTTP URL). */
  REDIS_URL: z.string().optional().default(''),
  /** Upstash Redis REST — used when `REDIS_URL` is empty. */
  UPSTASH_REDIS_REST_URL: z.string().optional().default(''),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional().default(''),
  /** QStash (HTTP) — stored for webhooks / future workers; not a drop-in for Bull. */
  QSTASH_URL: z.string().optional().default(''),
  QSTASH_TOKEN: z.string().optional().default(''),
  QSTASH_CURRENT_SIGNING_KEY: z.string().optional().default(''),
  QSTASH_NEXT_SIGNING_KEY: z.string().optional().default(''),
  CRAWLER_MAX_WORKERS: z.coerce.number().int().positive().default(5),
  CRAWL_DELAY_MS: z.coerce.number().int().nonnegative().default(1000),
  MAX_PAGES_PER_JOB: z.coerce.number().int().positive().default(2000),
  CRAWLER_USER_AGENT: z.string().default('SenkoBot/1.0'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  PAGERANK_CRON: z.string().default('0 3 * * *'),
  PAGERANK_ITERATIONS: z.coerce.number().int().positive().default(20),
  QUEUE_NAME: z.string().default('senko:crawl'),
  /**
   * Comma- or newline-separated crawl start URLs (live web). Used when `POST /api/crawl` omits `seedUrls`.
   * Nothing is bundled in-repo — set this or pass `seedUrls` in the request body.
   */
  SENKO_SEED_URLS: z.string().optional().default(''),
  /** Defaults for `npm run crawl:enqueue` / crawler CLI `--enqueue` (indexing via API worker). */
  CRAWL_CLI_MAX_DEPTH: z.coerce.number().int().min(0).max(5).default(2),
  CRAWL_CLI_MAX_PAGES: z.coerce.number().int().positive().max(5000).default(250),
  CRAWL_CLI_MAX_SEEDS: z.coerce.number().int().positive().max(200).default(40),
  /**
   * Optional [Brave Search API](https://brave.com/search/api/) key. Only used when `WEB_SEARCH_PROVIDER=brave`.
   * Default `meta` needs no keys (parallel HTML fetch from several engines).
   */
  BRAVE_SEARCH_API_KEY: z.string().optional().default(''),
  /**
   * `meta` (default) = open web via parallel DuckDuckGo/Bing/Google lite/Brave HTML + Bing images/videos/news — **no API keys**.  
   * `local` = only your crawl index. `brave` = official Brave JSON API (requires key). `hybrid` = merged meta-web + your index for web results.
   */
  WEB_SEARCH_PROVIDER: z.enum(['local', 'meta', 'brave', 'hybrid']).optional().default('meta'),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const msg = result.error.flatten().fieldErrors;
    throw new Error(`Invalid environment: ${JSON.stringify(msg)}`);
  }
  return result.data;
}

const parsed = parseEnv();

export const senkoConfig = {
  database: { url: parsed.DATABASE_URL },
  redis: {
    url: parsed.REDIS_URL,
    upstashRestUrl: parsed.UPSTASH_REDIS_REST_URL,
    upstashRestToken: parsed.UPSTASH_REDIS_REST_TOKEN,
  },
  qstash: {
    url: parsed.QSTASH_URL,
    token: parsed.QSTASH_TOKEN,
    currentSigningKey: parsed.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: parsed.QSTASH_NEXT_SIGNING_KEY,
  },
  crawler: {
    maxWorkers: parsed.CRAWLER_MAX_WORKERS,
    crawlDelayMs: parsed.CRAWL_DELAY_MS,
    maxPagesPerJob: parsed.MAX_PAGES_PER_JOB,
    userAgent: parsed.CRAWLER_USER_AGENT,
    queueName: parsed.QUEUE_NAME,
    seedUrlsEnv: parsed.SENKO_SEED_URLS,
    cliMaxDepth: parsed.CRAWL_CLI_MAX_DEPTH,
    cliMaxPages: parsed.CRAWL_CLI_MAX_PAGES,
    cliMaxSeeds: parsed.CRAWL_CLI_MAX_SEEDS,
  },
  api: {
    port: parsed.API_PORT,
    corsOrigin: parsed.CORS_ORIGIN,
    rateLimitWindowMs: parsed.RATE_LIMIT_WINDOW_MS,
    rateLimitMax: parsed.RATE_LIMIT_MAX,
  },
  pagerank: {
    cronSchedule: parsed.PAGERANK_CRON,
    iterations: parsed.PAGERANK_ITERATIONS,
  },
  search: {
    braveApiKey: parsed.BRAVE_SEARCH_API_KEY,
    webProvider: parsed.WEB_SEARCH_PROVIDER,
  },
} as const;

export type SenkoAppConfig = typeof senkoConfig;
