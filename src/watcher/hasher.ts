// Content hashing + dirty-flag logic.
//
// The watcher needs to decide whether a changed file actually needs re-indexing. We hash the
// file content with SHA-256 and compare to the stored hash; if they match, the change was a
// no-op save (common in editors) and we skip the re-parse.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { GraphStore } from '../graph/store.js';

/** SHA-256 hex digest of a string. */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Hash a file on disk by reading it. Returns null if the file can't be read. */
export function hashFile(absPath: string): string | null {
  try {
    return hashContent(readFileSync(absPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Decide whether a file needs re-indexing.
 * Returns true if the file is new OR its content hash differs from the stored hash.
 */
export function isDirty(store: GraphStore, relPath: string, newHash: string): boolean {
  const stored = store.getFileHash(relPath);
  return stored !== newHash;
}
