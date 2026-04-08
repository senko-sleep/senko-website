declare module 'probe-image-size' {
  import type { Readable } from 'node:stream';

  function probe(
    src: string | Buffer | Readable,
    options?: { timeout?: number },
  ): Promise<{ width: number | null; height: number | null; type?: string; length?: number }>;

  export default probe;
}
