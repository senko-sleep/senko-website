/** Build an embeddable player URL for common hosts (watch URLs often block iframes). */

export type EmbedPlayerOptions = {
  autoplay?: boolean;
  /** YouTube `fs=1` (player fullscreen control); default true for browse/modal. */
  allowInlineFullscreen?: boolean;
};

/** True for direct video files (use <video> or proxy stream), not HTML watch pages. */
export function isDirectVideoAssetUrl(pageUrl: string): boolean {
  try {
    const path = new URL(pageUrl).pathname.toLowerCase();
    return /\.(mp4|webm|ogg|ogv|mov)(\?|$)/i.test(path);
  } catch {
    return false;
  }
}

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

export function embedPlayerUrl(pageUrl: string, options?: EmbedPlayerOptions): string | null {
  if (isDirectVideoAssetUrl(pageUrl)) return pageUrl;

  const autoplay = options?.autoplay !== false;
  const fs = options?.allowInlineFullscreen !== false;
  const ap = autoplay ? '1' : '0';

  try {
    const u = new URL(pageUrl);
    if (u.hostname.includes('youtube.com')) {
      let id: string | null = null;
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      if (!id) {
        const shorts = u.pathname.match(/^\/shorts\/([^/?]+)/);
        if (shorts?.[1]) id = shorts[1]!;
      }
      if (!id) {
        const emb = u.pathname.match(/^\/embed\/([^/?]+)/);
        if (emb?.[1]) id = emb[1]!;
      }
      if (id) {
        const qs = new URLSearchParams();
        qs.set('autoplay', ap);
        if (fs) qs.set('fs', '1');
        qs.set('rel', '0');
        qs.set('modestbranding', '1');
        return `https://www.youtube.com/embed/${id}?${qs.toString()}`;
      }
    }
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      if (id)
        return `https://www.youtube.com/embed/${id}?${new URLSearchParams({
          autoplay: ap,
          ...(fs ? { fs: '1' } : {}),
          rel: '0',
          modestbranding: '1',
        }).toString()}`;
    }
    if (u.hostname.includes('vimeo.com')) {
      const m = u.pathname.match(/\/(\d+)/);
      if (m?.[1]) {
        const qs = new URLSearchParams();
        qs.set('autoplay', ap);
        if (fs) qs.set('fullscreen', '1');
        return `https://player.vimeo.com/video/${m[1]}?${qs.toString()}`;
      }
    }
    if (u.hostname.includes('dailymotion.com')) {
      const m = u.pathname.match(/\/video\/([^_/?]+)/);
      if (m?.[1]) {
        const qs = new URLSearchParams();
        qs.set('autoplay', ap);
        return `https://www.dailymotion.com/embed/video/${m[1]}?${qs.toString()}`;
      }
    }
    return null;
  } catch {
    return null;
  }
}
