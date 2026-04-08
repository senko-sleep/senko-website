const KEY = 'senko-search-history';

/** Primary navigation tabs: All merges web+images+videos+gifs; Search = web; Maps opens external map providers. */
export type SearchTab = 'all' | 'web' | 'image' | 'video' | 'gif' | 'news' | 'maps';

export interface HistoryEntry {
  query: string;
  type: SearchTab;
  timestamp: number;
}

export function loadHistory(): HistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

export function saveHistory(entries: HistoryEntry[]): void {
  localStorage.setItem(KEY, JSON.stringify(entries.slice(0, 20)));
}

export function addHistory(query: string, type: SearchTab): void {
  const cur = loadHistory().filter((h) => h.query !== query);
  cur.unshift({ query, type, timestamp: Date.now() });
  saveHistory(cur);
}
