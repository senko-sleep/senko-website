/** Build an embeddable player URL for common hosts (watch URLs often block iframes). */

export function youtubeIdFromPageUrl(pageUrl: string): string | null {
  try {
    const u = new URL(pageUrl);
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const shorts = u.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{6,24})/);
      if (shorts?.[1]) return shorts[1]!;
      const emb = u.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{6,24})/);
      if (emb?.[1]) return emb[1]!;
    }
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      return id && /^[a-zA-Z0-9_-]{6,24}$/.test(id) ? id : null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function youtubePosterUrl(id: string, tier: 'hq' | 'mq' | 'sd' = 'hq'): string {
  const t = tier === 'hq' ? 'hqdefault' : tier === 'mq' ? 'mqdefault' : 'sddefault';
  return `https://i.ytimg.com/vi/${id}/${t}.jpg`;
}

/** Best poster URL for a video tile (API thumb, or YouTube CDN fallback). */
export function videoPosterSrc(thumbnailUrl: string | null | undefined, pageUrl: string): string | undefined {
  const raw = thumbnailUrl?.trim();
  if (raw?.startsWith('//')) return `https:${raw}`;
  if (raw?.startsWith('http://') || raw?.startsWith('https://')) return raw;
  const yid = youtubeIdFromPageUrl(pageUrl);
  return yid ? youtubePosterUrl(yid, 'hq') : undefined;
}

/** Next tier if hq 404s (rare). */
export function youtubePosterFallbackTier(pageUrl: string, tried: 'hq' | 'mq'): string | undefined {
  const yid = youtubeIdFromPageUrl(pageUrl);
  if (!yid) return undefined;
  return tried === 'hq' ? youtubePosterUrl(yid, 'mq') : youtubePosterUrl(yid, 'sd');
}

export function embedPlayerUrl(pageUrl: string): string | null {
  try {
    const u = new URL(pageUrl);
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname === '/watch') {
        const id = u.searchParams.get('v');
        if (id) return `https://www.youtube.com/embed/${id}?autoplay=1`;
      }
      const shorts = u.pathname.match(/^\/shorts\/([^/?]+)/);
      if (shorts?.[1]) return `https://www.youtube.com/embed/${shorts[1]}?autoplay=1`;
    }
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      if (id) return `https://www.youtube.com/embed/${id}?autoplay=1`;
    }
    if (u.hostname.includes('vimeo.com')) {
      const m = u.pathname.match(/\/(\d+)/);
      if (m?.[1]) return `https://player.vimeo.com/video/${m[1]}?autoplay=1`;
    }
    if (u.hostname.includes('dailymotion.com')) {
      const m = u.pathname.match(/\/video\/([^_/?]+)/);
      if (m?.[1]) return `https://www.dailymotion.com/embed/video/${m[1]}?autoplay=1`;
    }
    return null;
  } catch {
    return null;
  }
}
