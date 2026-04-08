import { prisma } from '@senko/db';
import type { TextIndexResult } from './textIndexer.js';

export async function persistTextIndex(result: TextIndexResult): Promise<{ pageId: string }> {
  const page = await prisma.page.upsert({
    where: { url: result.url },
    create: {
      url: result.url,
      title: result.title,
      description: result.description,
      bodyText: result.bodyText,
      wordCount: result.wordCount,
      language: result.language,
      headings: result.headings,
      canonicalUrl: result.canonicalUrl,
    },
    update: {
      title: result.title,
      description: result.description,
      bodyText: result.bodyText,
      wordCount: result.wordCount,
      language: result.language,
      headings: result.headings,
      canonicalUrl: result.canonicalUrl,
    },
  });

  await prisma.keyword.deleteMany({ where: { pageId: page.id } });
  if (result.keywords.length > 0) {
    await prisma.keyword.createMany({
      data: result.keywords.map((k) => ({
        pageId: page.id,
        word: k.word,
        tfidf: k.tfidf,
        inTitle: k.inTitle,
        inHeading: k.inHeading,
        frequency: k.frequency,
      })),
    });
  }

  return { pageId: page.id };
}

export async function persistOutboundLinks(sourceUrl: string, targetUrls: string[]): Promise<void> {
  const existing = await prisma.page.findMany({
    where: { url: { in: targetUrls } },
    select: { url: true },
  });
  const allowed = new Set(existing.map((e) => e.url));
  for (const targetUrl of targetUrls) {
    if (!allowed.has(targetUrl) || targetUrl === sourceUrl) continue;
    const exists = await prisma.link.findFirst({ where: { sourceUrl, targetUrl } });
    if (!exists) {
      await prisma.link.create({
        data: {
          sourceUrl,
          targetUrl,
        },
      });
    }
  }
}
