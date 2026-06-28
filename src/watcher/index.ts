// File watcher with debounced incremental re-indexing.
//
// Watches the project tree with chokidar. On a file change/add, debounce 300ms then re-index
// only that file (skipping if its content hash is unchanged — handles editor save-without-edit).
// On unlink, remove the file + its symbols from the index.
//
// The watcher must NEVER throw into the event loop (it's a background process). All errors are
// caught and logged to stderr. It also never touches stdout.
//
// IMPORTANT (chokidar v4): the `ignored` option does NOT support glob patterns (that was removed
// in v4). It must be a function. We use a path-segment matcher so `node_modules` is excluded
// everywhere — this is what prevents the EMFILE ("too many open files") errors that a naive
// glob-based ignore would cause on large repos with thousands of dependency files.
import chokidar, { type FSWatcher } from 'chokidar';
import { relative, resolve, sep } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { GraphStore } from '../graph/store.js';
import { hashFile, isDirty } from './hasher.js';
import { indexFile } from '../parser/index.js';
import { pluginForFile } from '../parser/languages/registry.js';
import { toPosix } from '../utils/paths.js';
import { log } from '../utils/logger.js';

const DEBOUNCE_MS = 300;

/**
 * Directory names whose entire subtree is ignored by the watcher. We match by PATH SEGMENT
 * (anywhere in the path), which is what makes node_modules exclusion work under chokidar v4.
 */
const IGNORED_DIR_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.sliver',
  'dist',
  'build',
  'out',
  '__pycache__',
  '.next',
  '.nuxt',
  'coverage',
  '.cache',
  '.turbo',
]);

/** File suffixes that are never worth indexing (minified, sourcemaps). */
const IGNORED_SUFFIXES = ['.min.js', '.min.css', '.map'];

/**
 * chokidar v4 `ignored` matcher. Returns true if the path should be IGNORED.
 *
 * We check each path segment against the ignored-dir set (so any path containing a
 * `node_modules` segment anywhere is dropped), and the filename against ignored suffixes.
 * Matching is on the raw path — both absolute and relative forms work because we split on the
 * OS separator and also handle posix-style.
 */
function isIgnored(absOrRelPath: string): boolean {
  if (!absOrRelPath) return false;
  // Normalize to posix segments so the matcher is platform-independent.
  const segments = absOrRelPath.split(sep).join('/').split('/');
  for (const seg of segments) {
    if (IGNORED_DIR_SEGMENTS.has(seg)) return true;
  }
  for (const suffix of IGNORED_SUFFIXES) {
    if (absOrRelPath.endsWith(suffix)) return true;
  }
  // Hidden directories (dot-prefixed) other than the ones we explicitly allow.
  // (We already handle .git/.sliver above; this catches .vscode, .idea, etc.)
  for (const seg of segments) {
    if (seg.length > 1 && seg.startsWith('.')) return true;
  }
  return false;
}

/**
 * Start watching the project root for changes. Returns the chokidar watcher
 * (call .close() to stop). Reads from the GraphStore to detect unchanged files (hash dedup)
 * before re-parsing.
 */
export function startWatcher(store: GraphStore, projectRoot: string): FSWatcher {
  const root = resolve(projectRoot);
  const timers = new Map<string, NodeJS.Timeout>();

  const watcher = chokidar.watch(root, {
    ignored: isIgnored,
    persistent: true,
    ignoreInitial: true, // don't fire for files present at startup (already indexed)
    // If the OS file-descriptor limit is still exceeded (very unusual now that node_modules is
    // excluded), cap inotify/interval polling so we don't crash with EMFILE.
    usePolling: false,
    interval: 2000,
  });

  const relOf = (abs: string) => toPosix(relative(root, abs));

  const handleChange = (absPath: string): void => {
    const rel = relOf(absPath);
    if (!pluginForFile(rel)) return; // unsupported extension — don't index
    // Defensive: the `ignored` matcher should already have filtered this, but re-check on the
    // relative path in case of edge cases (e.g. symlinked dirs).
    if (isIgnored(rel)) return;
    // Debounce: collapse rapid saves into one re-index.
    const existing = timers.get(rel);
    if (existing) clearTimeout(existing);
    timers.set(
      rel,
      setTimeout(() => {
        timers.delete(rel);
        reindexFile(store, root, rel, absPath);
      }, DEBOUNCE_MS),
    );
  };

  watcher
    .on('change', handleChange)
    .on('add', handleChange)
    .on('unlink', (absPath) => {
      const rel = relOf(absPath);
      if (!pluginForFile(rel)) return;
      try {
        store.deleteFile(rel);
        log(`Removed from index: ${rel}`);
      } catch (err) {
        log(`Error removing ${rel}: ${(err as Error).message}`, 'error');
      }
    })
    .on('error', (err: unknown) =>
      log(`Watcher error: ${(err as Error).message}`, 'error'),
    );

  log('File watcher started');
  return watcher;
}

/** Re-index a single file if its content changed since the last index. */
function reindexFile(
  store: GraphStore,
  root: string,
  rel: string,
  abs: string,
): void {
  try {
    if (!existsSync(abs)) return;
    const newHash = hashFile(abs);
    if (!newHash) return;
    if (!isDirty(store, rel, newHash)) {
      log(`Skip (unchanged): ${rel}`);
      return;
    }
    const source = readFileSync(abs, 'utf-8');
    const result = indexFile(store, root, abs, source, newHash);
    if (result) log(`Re-indexed: ${rel}`);
  } catch (err) {
    log(`Error re-indexing ${rel}: ${(err as Error).message}`, 'error');
  }
}
