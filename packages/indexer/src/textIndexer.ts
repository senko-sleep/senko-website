import * as cheerio from 'cheerio';
import type { CrawledPage } from '@senko/shared';
import { prisma } from '@senko/db';
import { ENGLISH_STOPWORDS } from './stopwords.js';

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !ENGLISH_STOPWORDS.has(t));
}

export function calculateTFIDF(
  tokens: string[],
  totalPages: number,
  docFreq: (term: string) => number,
): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  const n = Math.max(1, totalPages);
  const out = new Map<string, number>();
  for (const [term, count] of tf) {
    const pagesWithToken = docFreq(term);
    const idf = Math.log(n / (pagesWithToken + 1));
    out.set(term, count * idf);
  }
  return out;
}

export interface KeywordInput {
  word: string;
  tfidf: number;
  inTitle: boolean;
  inHeading: boolean;
  frequency: number;
}

export interface TextIndexResult {
  url: string;
  title: string | null;
  description: string | null;
  bodyText: string | null;
  wordCount: number;
  language: string | null;
  headings: string[];
  canonicalUrl: string | null;
  crawledAt: Date;
  keywords: KeywordInput[];
}

export class TextIndexer {
  async processPage(crawledPage: CrawledPage): Promise<TextIndexResult> {
    const $ = cheerio.load(crawledPage.html);
    const title = $('title').first().text().trim() || null;
    const description =
      $('meta[name="description"]').attr('content')?.trim() ||
      $('meta[property="og:description"]').attr('content')?.trim() ||
      null;
    const language = $('html').attr('lang')?.trim() || null;
    const canonical =
      $('link[rel="canonical"]').attr('href')?.trim() ||
      $('meta[property="og:url"]').attr('content')?.trim() ||
      null;

    const headings: string[] = [];
    $('h1, h2, h3').each((_, el) => {
      const t = $(el).text().trim();
      if (t) headings.push(t);
    });

    const bodyClone = $('body').clone();
    bodyClone.find('script, style, noscript').remove();
    const bodyText = bodyClone.text().replace(/\s+/g, ' ').trim();
    const combined = `${title ?? ''} ${description ?? ''} ${headings.join(' ')} ${bodyText}`;
    const tokens = tokenize(combined);
    const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

    const totalPages = await prisma.page.count();
    const unique = [...new Set(tokens)];
    const dfs = await Promise.all(
      unique.map((t) => prisma.keyword.count({ where: { word: t } })),
    );
    const dfMap = new Map(unique.map((t, i) => [t, dfs[i]!]));

    const tfidf = calculateTFIDF(tokens, totalPages, (term) => dfMap.get(term) ?? 0);

    const keywords: KeywordInput[] = [];
    const titleLower = title?.toLowerCase() ?? '';
    for (const [term, score] of tfidf) {
      const frequency = tokens.filter((x) => x === term).length;
      keywords.push({
        word: term,
        tfidf: score,
        inTitle: titleLower.includes(term),
        inHeading: headings.some((h) => h.toLowerCase().includes(term)),
        frequency,
      });
    }

    return {
      url: crawledPage.url,
      title,
      description,
      bodyText: bodyText || null,
      wordCount,
      language,
      headings,
      canonicalUrl: canonical,
      crawledAt: crawledPage.crawledAt,
      keywords,
    };
  }
}
