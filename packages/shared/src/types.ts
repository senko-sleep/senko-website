/** Minimal async cache for web search results (Redis, Upstash REST, or in-memory). */
export interface SearchCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export type CrawlJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface CrawlJob {
  id: string;
  seedUrls: string[];
  maxDepth: number;
  maxPages: number;
  status: CrawlJobStatus;
  createdAt: Date;
}

export interface CrawledPage {
  url: string;
  html: string;
  statusCode: number;
  crawledAt: Date;
  contentType: string;
}

export interface IndexedPage {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  bodyText: string | null;
  wordCount: number;
  rankScore: number;
  crawledAt: Date;
  language?: string | null;
  headings?: string[];
  canonicalUrl?: string | null;
}

export interface IndexedImage {
  id: string;
  url: string;
  pageUrl: string;
  altText: string | null;
  width: number | null;
  height: number | null;
  format: string | null;
  crawledAt: Date;
}

export interface IndexedVideo {
  id: string;
  url: string;
  pageUrl: string;
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  duration: number | null;
  platform: string | null;
  crawledAt: Date;
}

export interface IndexedGif {
  id: string;
  url: string;
  pageUrl: string;
  altText: string | null;
  width: number | null;
  height: number | null;
  crawledAt: Date;
}

export type SearchResultType = 'web' | 'image' | 'video' | 'gif';

export interface SearchResult {
  type: SearchResultType;
  score: number;
  data: IndexedPage | IndexedImage | IndexedVideo | IndexedGif;
}

export interface SearchResponse {
  query: string;
  type: string;
  page: number;
  perPage: number;
  totalResults: number;
  results: SearchResult[];
}

export interface CrawlStats {
  totalPages: number;
  totalImages: number;
  totalVideos: number;
  totalGifs: number;
  errors: number;
  running: boolean;
}

export interface SenkoConfig {
  seedUrls: string[];
  maxDepth: number;
  maxPages: number;
  crawlDelayMs: number;
}

export interface ApiErrorBody {
  error: string;
  code?: string;
  details?: unknown;
}
