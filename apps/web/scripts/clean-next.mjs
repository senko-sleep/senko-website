import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const nextDir = resolve(here, '..', '.next');

try {
  rmSync(nextDir, { recursive: true, force: true });
  console.log('[senko] Cleared apps/web/.next');
} catch (error) {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'ENOTEMPTY')
  ) {
    console.log('[senko] Skipped .next cleanup because Windows still has a stale lock; continuing with build.');
  } else {
    console.warn('[senko] Unable to clear apps/web/.next', error);
  }
}
