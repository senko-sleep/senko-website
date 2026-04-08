export interface ParsedPage {
  url: string;
  html: string;
  statusCode: number;
  contentType: string;
  crawledAt: Date;
}

export interface ImageData {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  format: string | null;
}

export interface VideoData {
  url: string;
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  duration: number | null;
  platform: string | null;
}

export interface GifData {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  animated: boolean;
}
