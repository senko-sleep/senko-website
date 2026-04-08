import { Redis as IoRedis } from 'ioredis';
import { Redis as UpstashRedis } from '@upstash/redis';
import type { SearchCache } from '@senko/shared';
import { senkoConfig } from '@senko/shared';

export interface AppCache extends SearchCache {
  zincrby(key: string, increment: number, member: string): Promise<void>;
  zrevrangeWithScores(
    key: string,
    start: number,
    stop: number,
  ): Promise<{ member: string; score: number }[]>;
}

function memoryCache(): AppCache {
  const strings = new Map<string, { v: string; exp: number }>();
  const zsets = new Map<string, Map<string, number>>();
  const now = () => Date.now();
  return {
    async get(k) {
      const e = strings.get(k);
      if (!e) return null;
      if (e.exp < now()) {
        strings.delete(k);
        return null;
      }
      return e.v;
    },
    async set(k, v, ttlSeconds) {
      strings.set(k, { v, exp: now() + ttlSeconds * 1000 });
    },
    async zincrby(key, inc, member) {
      let m = zsets.get(key);
      if (!m) {
        m = new Map();
        zsets.set(key, m);
      }
      m.set(member, (m.get(member) ?? 0) + inc);
    },
    async zrevrangeWithScores(key, start, stop) {
      const m = zsets.get(key);
      if (!m) return [];
      const arr = [...m.entries()].map(([member, score]) => ({ member, score }));
      arr.sort((a, b) => b.score - a.score);
      return arr.slice(start, stop + 1);
    },
  };
}

function ioAdapter(r: IoRedis): AppCache {
  return {
    get: (k) => r.get(k),
    set: async (k, v, ttl) => {
      await r.set(k, v, 'EX', ttl);
    },
    zincrby: async (key, inc, member) => {
      await r.zincrby(key, inc, member);
    },
    zrevrangeWithScores: async (key, start, stop) => {
      const raw = await r.zrevrange(key, start, stop, 'WITHSCORES');
      const out: { member: string; score: number }[] = [];
      for (let i = 0; i < raw.length; i += 2) {
        out.push({ member: raw[i]!, score: Number(raw[i + 1]) });
      }
      return out;
    },
  };
}

function upstashAdapter(r: UpstashRedis): AppCache {
  return {
    get: async (k) => (await r.get<string | null>(k)) ?? null,
    set: async (k, v, ttl) => {
      await r.set(k, v, { ex: ttl });
    },
    zincrby: async (key, inc, member) => {
      await r.zincrby(key, inc, member);
    },
    zrevrangeWithScores: async (key, start, stop) => {
      const res = await r.zrange(key, start, stop, { rev: true, withScores: true });
      if (!res) return [];
      if (Array.isArray(res)) {
        const out: { member: string; score: number }[] = [];
        const arr = res as unknown[];
        for (let i = 0; i < arr.length; i += 2) {
          out.push({ member: String(arr[i]), score: Number(arr[i + 1]) });
        }
        return out;
      }
      return Object.entries(res as Record<string, number>).map(([member, score]) => ({ member, score }));
    },
  };
}

function createCache(): AppCache {
  const tcp = senkoConfig.redis.url?.trim();
  if (tcp) {
    return ioAdapter(new IoRedis(tcp));
  }
  const restUrl = senkoConfig.redis.upstashRestUrl?.trim();
  const restToken = senkoConfig.redis.upstashRestToken?.trim();
  if (restUrl && restToken) {
    return upstashAdapter(
      new UpstashRedis({
        url: restUrl,
        token: restToken,
      }),
    );
  }
  console.warn(
    '[senko] No REDIS_URL or UPSTASH_REDIS_REST_* — using in-memory cache. For production, set REDIS_URL (TLS URL from Upstash Redis) for Bull queues, or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN for REST. QStash (QSTASH_URL) is separate from Redis and does not replace REDIS_URL for Bull.',
  );
  return memoryCache();
}

export const cache = createCache();

/** @deprecated Use `cache` — alias for compatibility */
export const redis = cache;
