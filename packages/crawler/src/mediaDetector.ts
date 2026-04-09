import * as cheerio from 'cheerio';
import type { GifData, ImageData, ParsedPage, VideoData } from './types.js';

function extFormat(url: string): string | null {
  const m = url.toLowerCase().match(/\.(jpe?g|png|webp|svg|avif|gif)/);
  if (!m) return null;
  const e = m[1]!;
  if (e === 'jpeg' || e === 'jpg') return 'jpg';
  return e;
}

function parseSrcset(srcset: string | undefined): string[] {
  if (!srcset) return [];
  return srcset
    .split(',')
    .map((s) => s.trim().split(/\s+/)[0])
    .filter(Boolean) as string[];
}

function parseImageCandidates(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter((part) => Boolean(part) && !/^\d+(w|x)$/i.test(part));
}

function extractYoutubeId(u: string): string | null {
  try {
    const url = new URL(u);
    if (url.hostname.includes('youtu.be')) {
      return url.pathname.slice(1).split('/')[0] ?? null;
    }
    if (url.hostname.includes('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v) return v;
      const m = url.pathname.match(/\/embed\/([^/?]+)/);
      if (m) return m[1] ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

function detectPlatform(src: string): string | null {
  try {
    const h = new URL(src).hostname.replace(/^www\./, '');
    if (h.includes('youtube.com') || h.includes('youtu.be')) return 'youtube';
    if (h.includes('vimeo.com')) return 'vimeo';
    if (h.includes('dailymotion.com')) return 'dailymotion';
    if (h.includes('giphy.com')) return 'giphy';
    if (h.includes('tenor.com')) return 'tenor';
  } catch {
    return null;
  }
  return null;
}

export class MediaDetector {
  detect(page: ParsedPage): { images: ImageData[]; videos: VideoData[]; gifs: GifData[] } {
    const $ = cheerio.load(page.html);
    const base = page.url;

    const images: ImageData[] = [];
    const videos: VideoData[] = [];
    const gifs: GifData[] = [];
    const seen = new Set<string>();

    const pushImg = (rawUrl: string | undefined, alt: string | null, w: string | null, h: string | null) => {
      if (!rawUrl) return;
      if (rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) return;
      let abs: string;
      try {
        abs = new URL(rawUrl, base).href;
      } catch {
        return;
      }
      if (seen.has(abs)) return;
      seen.add(abs);
      const format = extFormat(abs);
      const width = w ? parseInt(w, 10) : null;
      const height = h ? parseInt(h, 10) : null;
      const img: ImageData = {
        url: abs,
        alt,
        width: Number.isFinite(width as number) ? width : null,
        height: Number.isFinite(height as number) ? height : null,
        format,
      };
      if (format === 'gif' || abs.toLowerCase().endsWith('.gif')) {
        gifs.push({
          url: abs,
          alt,
          width: img.width,
          height: img.height,
          animated: true,
        });
      } else {
        images.push(img);
      }
    };

    const pushImgVariants = (
      urls: Array<string | undefined>,
      alt: string | null,
      w: string | null,
      h: string | null,
    ) => {
      for (const url of urls) {
        pushImg(url, alt, w, h);
      }
    };

    $('img[src]').each((_, el) => {
      const $el = $(el);
      const alt = $el.attr('alt') ?? $el.attr('title') ?? null;
      const width = $el.attr('width') ?? $el.attr('data-width') ?? null;
      const height = $el.attr('height') ?? $el.attr('data-height') ?? null;
      pushImgVariants(
        [
          $el.attr('src'),
          $el.attr('data-src'),
          $el.attr('data-lazy-src'),
          $el.attr('data-original'),
          $el.attr('data-image'),
          $el.attr('data-fallback-src'),
          ...parseSrcset($el.attr('srcset')),
          ...parseSrcset($el.attr('data-srcset')),
          ...parseImageCandidates($el.attr('data-images')),
        ],
        alt,
        width,
        height,
      );
    });

    $('[style*="background"]').each((_, el) => {
      const style = $(el).attr('style') || '';
      const matches = [...style.matchAll(/background(?:-image)?:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)];
      for (const match of matches) {
        if (match[1]) pushImg(match[1], null, null, null);
      }
    });

    $('picture source[srcset], source[srcset]').each((_, el) => {
      const srcset = $(el).attr('srcset');
      for (const u of parseSrcset(srcset)) {
        pushImg(u, null, null, null);
      }
    });

    $('source[data-srcset], source[data-src]').each((_, el) => {
      const $el = $(el);
      for (const u of parseSrcset($el.attr('data-srcset'))) {
        pushImg(u, null, null, null);
      }
      pushImg($el.attr('data-src'), null, null, null);
    });

    const ogImage = $('meta[property="og:image"]').attr('content');
    pushImg(ogImage, $('meta[property="og:image:alt"]').attr('content') ?? null, null, null);
    pushImg($('meta[property="og:image:secure_url"]').attr('content'), $('meta[property="og:image:alt"]').attr('content') ?? null, null, null);
    const twImage = $('meta[name="twitter:image"]').attr('content');
    pushImg(twImage, null, null, null);
    pushImg($('meta[name="twitter:image:src"]').attr('content'), null, null, null);
    pushImg($('meta[itemprop="image"]').attr('content'), null, null, null);

    $('link[rel="image_src"], link[rel="preload"][as="image"], link[rel="prefetch"][as="image"]').each((_, el) => {
      pushImg($(el).attr('href'), null, null, null);
    });

    $('[data-bg], [data-background], [data-bg-src], [data-background-image]').each((_, el) => {
      const $el = $(el);
      pushImgVariants(
        [
          $el.attr('data-bg'),
          $el.attr('data-background'),
          $el.attr('data-bg-src'),
          $el.attr('data-background-image'),
        ],
        null,
        null,
        null,
      );
    });

    $('noscript').each((_, el) => {
      const raw = $(el).html();
      if (!raw) return;
      const inner = cheerio.load(raw);
      inner('img').each((__, img) => {
        const $img = inner(img);
        pushImgVariants(
          [
            $img.attr('src'),
            $img.attr('data-src'),
            ...parseSrcset($img.attr('srcset')),
          ],
          $img.attr('alt') ?? $img.attr('title') ?? null,
          $img.attr('width') ?? null,
          $img.attr('height') ?? null,
        );
      });
    });

    if (ogImage?.toLowerCase().endsWith('.gif')) {
      const abs = new URL(ogImage, base).href;
      gifs.push({ url: abs, alt: null, width: null, height: null, animated: true });
    }

    const pushVideo = (v: VideoData) => {
      const k = v.url;
      if (seen.has(k)) return;
      seen.add(k);
      videos.push(v);
    };

    $('video[src]').each((_, el) => {
      const $el = $(el);
      const src = $el.attr('src');
      if (src) {
        try {
          const abs = new URL(src, base).href;
          pushVideo({
            url: abs,
            title: $el.attr('title') ?? null,
            description: null,
            thumbnailUrl: null,
            duration: null,
            platform: 'html5',
          });
        } catch {
          /* skip */
        }
      }
    });

    $('video source[src]').each((_, el) => {
      const src = $(el).attr('src');
      if (!src) return;
      try {
        const abs = new URL(src, base).href;
        pushVideo({
          url: abs,
          title: null,
          description: null,
          thumbnailUrl: null,
          duration: null,
          platform: 'html5',
        });
      } catch {
        /* skip */
      }
    });

    const ogVideo = $('meta[property="og:video"]').attr('content');
    if (ogVideo) {
      try {
        const abs = new URL(ogVideo, base).href;
        const yt = extractYoutubeId(abs);
        pushVideo({
          url: abs,
          title: $('meta[property="og:title"]').attr('content') ?? null,
          description: $('meta[property="og:description"]').attr('content') ?? null,
          thumbnailUrl: yt ? `https://img.youtube.com/vi/${yt}/hqdefault.jpg` : $('meta[property="og:image"]').attr('content') ?? null,
          duration: null,
          platform: detectPlatform(abs),
        });
      } catch {
        /* skip */
      }
    }

    $('iframe[src]').each((_, el) => {
      const src = $(el).attr('src');
      if (!src) return;
      let abs: string;
      try {
        abs = new URL(src, base).href;
      } catch {
        return;
      }
      const host = new URL(abs).hostname;
      const yt = extractYoutubeId(abs);
      if (yt) {
        pushVideo({
          url: abs,
          title: $(el).attr('title') ?? null,
          description: null,
          thumbnailUrl: `https://img.youtube.com/vi/${yt}/hqdefault.jpg`,
          duration: null,
          platform: 'youtube',
        });
        return;
      }
      if (host.includes('vimeo.com')) {
        pushVideo({
          url: abs,
          title: $(el).attr('title') ?? null,
          description: null,
          thumbnailUrl: null,
          duration: null,
          platform: 'vimeo',
        });
        return;
      }
      if (host.includes('dailymotion.com')) {
        pushVideo({
          url: abs,
          title: $(el).attr('title') ?? null,
          description: null,
          thumbnailUrl: null,
          duration: null,
          platform: 'dailymotion',
        });
        return;
      }
      if (host.includes('giphy.com') || host.includes('tenor.com')) {
        gifs.push({
          url: abs,
          alt: $(el).attr('title') ?? null,
          width: null,
          height: null,
          animated: true,
        });
      }
    });

    return { images, videos, gifs };
  }
}
