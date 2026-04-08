import cron from 'node-cron';
import { prisma } from '@senko/db';
import { senkoConfig } from '@senko/shared';

export class PageRank {
  async compute(iterations = 20, dampingFactor = 0.85): Promise<void> {
    const pages = await prisma.page.findMany({ select: { url: true } });
    const urls = pages.map((p) => p.url);
    const n = urls.length;
    if (n === 0) return;

    const urlIndex = new Map(urls.map((u, i) => [u, i]));
    const outLinks = await prisma.link.findMany({
      select: { sourceUrl: true, targetUrl: true },
    });

    const adj = new Map<number, number[]>();
    const outCount = new Map<number, number>();
    for (const u of urls) {
      const i = urlIndex.get(u)!;
      adj.set(i, []);
      outCount.set(i, 0);
    }
    for (const l of outLinks) {
      const si = urlIndex.get(l.sourceUrl);
      const ti = urlIndex.get(l.targetUrl);
      if (si == null || ti == null) continue;
      adj.get(si)!.push(ti);
      outCount.set(si, (outCount.get(si) ?? 0) + 1);
    }

    let pr = new Array(n).fill(1 / n);
    const d = dampingFactor;
    for (let it = 0; it < iterations; it++) {
      const next = new Array(n).fill((1 - d) / n);
      for (let i = 0; i < n; i++) {
        const outs = outCount.get(i) ?? 0;
        if (outs === 0) continue;
        const share = (d * pr[i]!) / outs;
        for (const j of adj.get(i) ?? []) {
          next[j] += share;
        }
      }
      pr = next;
    }

    const updates = urls.map((u, i) =>
      prisma.page.update({
        where: { url: u },
        data: { rankScore: pr[i]! },
      }),
    );
    await prisma.$transaction(updates);
  }
}

export function schedulePageRank(job: PageRank): void {
  cron.schedule(senkoConfig.pagerank.cronSchedule, () => {
    void job.compute(senkoConfig.pagerank.iterations);
  });
}
