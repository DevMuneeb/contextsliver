#!/usr/bin/env node
// Postinstall hint for contextsliver.
//
// ContextSliver depends on native modules (better-sqlite3, tree-sitter) that need their install
// scripts to run in order to fetch/build their platform binaries. Modern npm (v10+) blocks
// install scripts by default, so the first install can land without those binaries. This hint
// prints a short reminder to stderr (never stdout — that would corrupt the npm output stream)
// telling the user how to finish the install if so.
//
// It is intentionally harmless: it only checks for the binaries and prints a message. The
// `|| true` in package.json means it never blocks the install.
import { existsSync, readdirSync, statSync } from 'node:fs';

try {
  const missing = [
    ['tree-sitter', fileExistsDeep('node_modules/tree-sitter', '.node') ? null : 'tree-sitter'],
    [
      'better-sqlite3',
      fileExistsDeep('node_modules/better-sqlite3', '.node') ? null : 'better-sqlite3',
    ],
  ]
    .filter((x) => x[1])
    .map((x) => x[1]);

  if (missing.length > 0) {
    process.stderr.write(
      '\n[contextsliver] Native binaries for ' +
        missing.join(', ') +
        ' were not found.\n' +
        'If the install scripts were blocked, finish the setup with:\n\n' +
        '    npm rebuild ' +
        missing.join(' ') +
        '\n\n' +
        '(or: npm approve-scripts ' +
        missing.join(' ') +
        ' && npm rebuild ' +
        missing.join(' ') +
        ')\n\n',
    );
  }
} catch {
  // Never let the postinstall hint fail the install.
}

/**
 * Recursively check whether a directory contains a file ending in `suffix`, up to depth 3.
 * Used to detect whether native build artifacts (e.g. *.node) were produced.
 */
function fileExistsDeep(dir, suffix, depth = 3) {
  if (!existsSync(dir) || depth <= 0) return false;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return false;
  }
  for (const entry of entries) {
    const full = dir + '/' + entry;
    if (entry.endsWith(suffix)) return true;
    if (!entry.startsWith('.') && entry !== 'node_modules') {
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory() && fileExistsDeep(full, suffix, depth - 1)) {
        return true;
      }
    }
  }
  return false;
}
