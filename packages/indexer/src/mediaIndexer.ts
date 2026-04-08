import axios from 'axios';
import probe from 'probe-image-size';
import { prisma } from '@senko/db';
import type { ImageData, GifData, VideoData } from '@senko/crawler';

function formatFromUrl(url: string): string | null {
  const m = url.toLowerCase().match(/\.(jpe?g|png|webp|svg|avif|gif)/);
  if (!m) return null;
  return m[1] === 'jpeg' ? 'jpg' : m[1]!;
}

async function probeDims(url: string): Promise<{ width: number | null; height: number | null }> {
  try {
    const result = await probe(url);
    return { width: result.width ?? null, height: result.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

export class ImageIndexer {
  async processImages(images: ImageData[], pageUrl: string): Promise<void> {
    const seen = new Set<string>();
    const batch: Array<{
      url: string;
      pageUrl: string;
      altText: string | null;
      width: number | null;
      height: number | null;
      format: string | null;
    }> = [];

    for (const img of images) {
      if (seen.has(img.url)) continue;
      seen.add(img.url);
      let w = img.width;
      let h = img.height;
      if ((w == null || h == null) && img.url.startsWith('http')) {
        const dims = await probeDims(img.url);
        w = w ?? dims.width;
        h = h ?? dims.height;
      }
      if (w != null && h != null && (w < 50 || h < 50)) continue;
      batch.push({
        url: img.url,
        pageUrl,
        altText: img.alt,
        width: w,
        height: h,
        format: img.format ?? formatFromUrl(img.url),
      });
    }

    for (const row of batch) {
      await prisma.image.upsert({
        where: { url: row.url },
        create: row,
        update: {
          pageUrl: row.pageUrl,
          altText: row.altText,
          width: row.width,
          height: row.height,
          format: row.format,
        },
      });
    }
  }
}

async function vimeoThumb(url: string): Promise<string | null> {
  try {
    const res = await axios.get<{ thumbnail_url?: string }>(
      `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
      { timeout: 8000 },
    );
    return res.data.thumbnail_url ?? null;
  } catch {
    return null;
  }
}

export class VideoIndexer {
  async processVideos(videos: VideoData[], pageUrl: string): Promise<void> {
    const seen = new Set<string>();
    for (const v of videos) {
      if (seen.has(v.url)) continue;
      seen.add(v.url);
      let thumb = v.thumbnailUrl;
      let platform = v.platform;
      if (v.url.includes('vimeo.com') && !thumb) {
        thumb = (await vimeoThumb(v.url)) ?? null;
        platform = platform ?? 'vimeo';
      }
      if (v.url.includes('youtube.com') || v.url.includes('youtu.be')) {
        const m = v.url.match(/[?&]v=([^&]+)/) ?? v.url.match(/youtu\.be\/([^/?]+)/);
        const id = m?.[1];
        if (id) {
          thumb = `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
          platform = 'youtube';
        }
      }

      await prisma.video.upsert({
        where: { url: v.url },
        create: {
          url: v.url,
          pageUrl,
          title: v.title,
          description: v.description,
          thumbnailUrl: thumb,
          platform,
          duration: v.duration,
        },
        update: {
          pageUrl,
          title: v.title,
          description: v.description,
          thumbnailUrl: thumb ?? undefined,
          platform: platform ?? undefined,
          duration: v.duration,
        },
      });
    }
  }
}

export class GifIndexer {
  async processGifs(gifs: GifData[], pageUrl: string): Promise<void> {
    const seen = new Set<string>();
    for (const g of gifs) {
      if (seen.has(g.url)) continue;
      seen.add(g.url);
      let w = g.width;
      let h = g.height;
      if ((w == null || h == null) && g.url.startsWith('http')) {
        const dims = await probeDims(g.url);
        w = w ?? dims.width;
        h = h ?? dims.height;
      }
      let animated = g.animated;
      if (g.url.startsWith('http')) {
        try {
          const head = await axios.get(g.url, { responseType: 'arraybuffer', maxContentLength: 500_000, timeout: 10000 });
          const len = head.data.byteLength ?? 0;
          animated = len > 100_000;
        } catch {
          animated = true;
        }
      }

      await prisma.gif.upsert({
        where: { url: g.url },
        create: {
          url: g.url,
          pageUrl,
          altText: g.alt,
          width: w,
          height: h,
          animated,
        },
        update: {
          pageUrl,
          altText: g.alt,
          width: w,
          height: h,
          animated,
        },
      });
    }
  }
}
