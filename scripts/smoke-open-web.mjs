/**
 * Verifies default open-web search (meta mode, no API keys): diverse HTTPS web hits.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadDotEnv();

const baseApi = process.env.SENKO_API_URL ?? 'http://localhost:4000';

async function main() {
  if (process.env.WEB_SEARCH_PROVIDER === 'local') {
    console.log('SKIP: WEB_SEARCH_PROVIDER=local (enable meta or unset for default open-web smoke)');
    return;
  }

  const q = 'spy x family';
  const url = `${baseApi}/api/search?q=${encodeURIComponent(q)}&type=web&page=1&perPage=12&safe=0`;
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  const results = Array.isArray(json.results) ? json.results : [];

  const hosts = new Set(
    results
      .map((r) => {
        try {
          return new URL(r?.data?.url).hostname.replace(/^www\./, '');
        } catch {
          return '';
        }
      })
      .filter(Boolean),
  );

  console.log('HTTP', res.status, '| web hits:', results.length, '| hosts:', [...hosts].slice(0, 8).join(', '));

  if (!res.ok) {
    console.error('FAIL: API error');
    process.exitCode = 1;
    return;
  }
  if (results.length < 3) {
    console.error('FAIL: too few results (engines may be rate-limiting; retry or exit corporate VPN)');
    process.exitCode = 1;
    return;
  }
  if (hosts.size < 2) {
    console.error('FAIL: expected multiple domains in merged meta results');
    process.exitCode = 1;
    return;
  }

  console.log('PASS');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
