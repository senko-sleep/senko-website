import { existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const nextDir = join(webRoot, '.next');
const TRASH_PREFIX = '.next.senko-trash-';

function gcTrashDirs() {
  let entries;
  try {
    entries = readdirSync(webRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (!ent.isDirectory() || !ent.name.startsWith('.next.senko-trash-')) continue;
    const p = join(webRoot, ent.name);
    try {
      rmSync(p, { recursive: true, force: true, maxRetries: 12, retryDelay: 120 });
      console.log('[senko] Removed old', ent.name);
    } catch {
      /* another process may hold files */
    }
  }
}

function removeInPlace(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 18, retryDelay: 150 });
    return true;
  } catch {
    try {
      rmSync(dir, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }
}

async function main() {
  gcTrashDirs();

  if (!existsSync(nextDir)) {
    console.log('[senko] No apps/web/.next to clear');
    return;
  }

  const trash = join(webRoot, `${TRASH_PREFIX}${Date.now()}`);
  try {
    renameSync(nextDir, trash);
    console.log('[senko] Rotated apps/web/.next aside for deletion');
  } catch (err) {
    console.log('[senko] Could not rename .next (often in use); deleting in place…');
    for (let attempt = 0; attempt < 10; attempt++) {
      if (removeInPlace(nextDir)) {
        console.log('[senko] Cleared apps/web/.next');
        return;
      }
      await new Promise((r) => setTimeout(r, 350 + attempt * 120));
    }
    console.warn(
      '[senko] Stop `next dev`, delete apps/web/.next manually, then run `npm run dev:fresh -w @senko/web`.',
    );
    return;
  }

  try {
    rmSync(trash, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
    console.log('[senko] Removed previous scratch .next folder');
  } catch {
    console.warn(`[senko] Could not delete ${trash} yet — ok to delete later when no process locks it.`);
  }
}

await main();
