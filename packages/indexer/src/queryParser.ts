import { ENGLISH_STOPWORDS } from './stopwords.js';

export type SearchType = 'web' | 'image' | 'video' | 'gif' | 'all' | 'news';

export interface DateRange {
  from?: Date;
  to?: Date;
}

export interface QueryFilters {
  format?: string;
  minWidth?: number;
  minHeight?: number;
  platform?: string;
  dateRange?: DateRange;
  hasThumb?: boolean;
}

export interface ParsedQuery {
  terms: string[];
  phrase?: string;
  type: SearchType;
  filters: QueryFilters;
}

function normalizeToken(t: string): string {
  return t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export class QueryParser {
  parse(raw: string, type: SearchType): ParsedQuery {
    let s = raw.trim();
    const filters: QueryFilters = {};
    let phrase: string | undefined;

    const typeMatch = s.match(/\btype:(\w+)/i);
    if (typeMatch) {
      const t = typeMatch[1]!.toLowerCase();
      if (['web', 'image', 'video', 'gif', 'news', 'all'].includes(t)) {
        type = t as SearchType;
      }
      s = s.replace(typeMatch[0], '').trim();
    }

    const formatMatch = s.match(/\bformat:([\w]+)/i);
    if (formatMatch) {
      filters.format = formatMatch[1]!.toLowerCase();
      s = s.replace(formatMatch[0], '').trim();
    }

    const quoted = s.match(/"([^"]+)"/);
    if (quoted) {
      phrase = quoted[1]!;
      s = s.replace(quoted[0], ' ').trim();
    }

    const tokens = s
      .split(/\s+/)
      .map(normalizeToken)
      .filter((t) => t.length > 0 && !ENGLISH_STOPWORDS.has(t));

    return {
      terms: tokens,
      phrase,
      type,
      filters,
    };
  }
}
