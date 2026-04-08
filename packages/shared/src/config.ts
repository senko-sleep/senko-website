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
} as const;

export type SenkoAppConfig = typeof senkoConfig;
