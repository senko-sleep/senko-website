/**
 * Clear search popularity ZSET without redis-cli (Windows-friendly).
 * Uses REDIS_URL (ioredis), or Upstash REST, or `docker compose exec redis`.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const KEY = 'senko:trending';

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

async function delUpstash() {
  const base = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, '');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!base || !token) throw new Error('Upstash REST env vars not set');
  const res = await fetch(`${base}/del/${encodeURIComponent(KEY)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstash del failed ${res.status}: ${text}`);
  }
  const j = await res.json().catch(() => ({}));
  return j;
}

function delDockerCompose() {
  const r = spawnSync(
    'docker',
    ['compose', '-f', resolve(repoRoot, 'docker-compose.yml'), 'exec', '-T', 'redis', 'redis-cli', 'DEL', KEY],
    { encoding: 'utf8', cwd: repoRoot },
  );
  return r;
}

async function main() {
  const redisUrl = process.env.REDIS_URL?.trim();

  if (redisUrl) {
    try {
      const require = createRequire(import.meta.url);
      const Redis = require('ioredis');
      const client = new Redis(redisUrl, {
        maxRetriesPerRequest: 2,
        connectTimeout: 8000,
        enableOfflineQueue: true,
        retryStrategy: () => null,
      });
      try {
        const n = await client.del(KEY);
        console.log(`DEL ${KEY} via REDIS_URL -> ${n} (1 = removed)`);
      } finally {
        client.disconnect();
      }
      return;
    } catch (e) {
      console.error('ioredis failed:', e instanceof Error ? e.message : e);
    }
  }

  if (process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim()) {
    try {
      await delUpstash();
      console.log(`DEL ${KEY} via Upstash REST (ok)`);
      return;
    } catch (e) {
      console.error('Upstash failed:', e instanceof Error ? e.message : e);
    }
  }

  const d = delDockerCompose();
  if (d.status === 0 && d.stdout) {
    console.log(d.stdout.trim());
    console.log(`DEL ${KEY} via docker compose exec redis (ok)`);
    return;
  }

  console.error(
    [
      'Could not clear trending: no working REDIS_URL + ioredis, Upstash REST, or docker compose redis.',
      '',
      'Fix one of:',
      '  • Install deps: npm install (then re-run this script; uses hoisted ioredis)',
      '  • Or: docker compose up -d redis  then: npm run clear:trending',
      '  • Or: restart the API only if it logged "in-memory cache" — that clears on restart.',
    ].join('\n'),
  );
  process.exitCode = 1;
}

await main();
