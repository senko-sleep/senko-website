/**
 * Requires BRAVE_SEARCH_API_KEY + running API. Checks open-web search has diverse HTTPS results.
 * Skip (exit 0) if key missing — CI-friendly.
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
  if (!process.env.BRAVE_SEARCH_API_KEY?.trim()) {
    console.log('SKIP: BRAVE_SEARCH_API_KEY not set (add key from https://brave.com/search/api/ then re-run)');
    return;
  }

  const q = 'spy x family';
  const url = `${baseApi}/api/search?q=${encodeURIComponent(q)}&type=web&page=1&perPage=15&safe=0`;
  const res = await fetch(url);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error('Non-JSON response:', text.slice(0, 500));
    process.exitCode = 1;
    return;
  }

  if (!res.ok) {
    console.error('HTTP', res.status, text.slice(0, 400));
    process.exitCode = 1;
    return;
  }

  const results = Array.isArray(json.results) ? json.results : [];
  const urls = results.map((r) => r?.data?.url).filter((u) => typeof u === 'string');
  const hosts = new Set(urls.map((u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }).filter(Boolean));

  console.log('web results:', results.length, '| distinct hosts:', hosts.size);
  console.log([...hosts].slice(0, 12).join(', '));

  if (results.length < 5) {
    console.error('FAIL: expected at least 5 web results (check API key quota and Brave API errors)');
    process.exitCode = 1;
    return;
  }
  if (hosts.size < 3) {
    console.error('FAIL: expected results from several domains (got', hosts.size, ')');
    process.exitCode = 1;
    return;
  }

  console.log('PASS');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
