const baseWeb = process.env.SENKO_WEB_URL ?? 'http://localhost:3000';
const baseApi = process.env.SENKO_API_URL ?? 'http://localhost:4000';

/** After a real crawl, topics below should hit indexed text/media. Media checks are optional (depends on seeds). */
const checks = [
  { label: 'web: naruto', type: 'web', q: 'naruto' },
  { label: 'web: fandom', type: 'web', q: 'fandom' },
  { label: 'web: wiki', type: 'web', q: 'wikipedia' },
  /** `safe=0` must surface real web hits (not only safe-filtered stubs). */
  { label: 'web: unfiltered', type: 'web', q: 'porn' },
  { label: 'images: logo or photo', type: 'image', q: 'logo', optional: true },
  /** Brave tiles merged when `safe=0`; Bing alone stays SFW-heavy for broad queries. */
  { label: 'images: unfiltered merge', type: 'image', q: 'porn', optional: true },
  { label: 'videos: cats (bing layout)', type: 'video', q: 'cats' },
  { label: 'videos: video', type: 'video', q: 'video', optional: true },
  { label: 'all: star', type: 'all', q: 'star' },
  { label: 'news: reuters path', type: 'news', q: 'news', optional: true },
];

async function getJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { ok: response.ok, status: response.status, json, text };
}

async function assertReady() {
  const [web, api] = await Promise.all([
    fetch(baseWeb, { redirect: 'manual' }).catch((error) => ({ ok: false, error })),
    getJson(`${baseApi}/api/health`).catch((error) => ({ ok: false, error })),
  ]);

  if (!web.ok) {
    throw new Error(`Web app is not reachable at ${baseWeb}`);
  }
  if (!api.ok) {
    throw new Error(`API is not healthy at ${baseApi}/api/health`);
  }
}

async function main() {
  await assertReady();

  const results = [];
  for (const check of checks) {
    const url = `${baseApi}/api/search?q=${encodeURIComponent(check.q)}&type=${check.type}&page=1&perPage=10&safe=0`;
    const started = Date.now();
    const res = await getJson(url);
    const duration = Date.now() - started;
    const total = Number(res.json?.totalResults ?? 0);
    const received = Array.isArray(res.json?.results) ? res.json.results.length : 0;
    const optional = Boolean(check.optional);
    const hasHits = total > 0 && received > 0;
    const ok = optional ? res.ok : res.ok && hasHits;
    results.push({
      label: check.label,
      status: res.status,
      duration,
      total,
      received,
      ok,
      optional,
      skipped: optional && res.ok && !hasHits,
    });
  }

  for (const row of results) {
    let marker = row.ok ? 'PASS' : 'FAIL';
    if (row.skipped) marker = 'SKIP';
    console.log(`${marker} | ${row.label} | status=${row.status} | total=${row.total} | received=${row.received} | ${row.duration}ms`);
  }

  const failed = results.filter((row) => !row.ok && !row.optional);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
