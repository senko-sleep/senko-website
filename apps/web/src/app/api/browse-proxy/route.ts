import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAX_BYTES = 2_500_000;

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '0.0.0.0' || h === '[::1]' || h === '::1') return true;
  if (h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h.includes('metadata.google') || h.includes('metadata.gce')) return true;

  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0 || a === 255) return true;
  }
  return false;
}

function normalizeTargetUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (isBlockedHostname(u.hostname)) return null;
    u.hash = '';
    return u;
  } catch {
    return null;
  }
}

function injectBaseTag(html: string, baseHref: string): string {
  const safeBase = baseHref.replace(/"/g, '&quot;');
  const tag = `<base href="${safeBase}">`;
  const headOpen = html.match(/<head([^>]*)>/i);
  if (headOpen && headOpen.index !== undefined) {
    const idx = headOpen.index + headOpen[0].length;
    return html.slice(0, idx) + tag + html.slice(idx);
  }
  if (/<!DOCTYPE/i.test(html)) {
    return html.replace(/<!DOCTYPE[^>]*>/i, (m) => `${m}\n<head>${tag}</head>`);
  }
  return `<!DOCTYPE html><html><head>${tag}</head><body>${html}</body></html>`;
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url');
  if (!raw) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid url encoding' }, { status: 400 });
  }

  const target = normalizeTargetUrl(decoded);
  if (!target) {
    return NextResponse.json({ error: 'URL not allowed' }, { status: 403 });
  }

  let res: Response;
  try {
    res = await fetch(target.href, {
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: '*/*',
      },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return NextResponse.json({ error: 'Fetch failed' }, { status: 502 });
  }

  if (!res.ok) {
    return NextResponse.json({ error: `Upstream ${res.status}` }, { status: 502 });
  }

  const ct = res.headers.get('content-type') ?? '';
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'Response too large' }, { status: 413 });
  }

  const isHtml = ct.includes('text/html') || ct.includes('application/xhtml');
  if (!isHtml) {
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': ct.split(';')[0]?.trim() || 'application/octet-stream',
        'Cache-Control': 'private, max-age=300',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  }

  let html = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  const baseHref = new URL('.', target.href).href;
  html = injectBaseTag(html, baseHref);
  html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, max-age=120',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
