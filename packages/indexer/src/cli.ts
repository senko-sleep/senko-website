import { PageRank } from './pagerank.js';

async function main(): Promise<void> {
  const pr = new PageRank();
  await pr.compute();
  console.log('PageRank done');
}

main().catch(console.error);
