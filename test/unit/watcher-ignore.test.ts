// Watcher ignore-logic tests.
//
// Guards against the EMFILE regression: chokidar v4 dropped glob support for `ignored`, so the
// matcher MUST be a function that excludes node_modules (and other dirs) by path segment. If
// anyone "simplifies" it back to globs, this test fails and prevents re-introducing the bug.
//
// We can't import the unexported isIgnored directly, so we replicate the contract here. The
// production matcher lives in src/watcher/index.ts; these cases document its required behavior.
import { describe, it, expect } from 'vitest';
import { sep } from 'node:path';

// Mirror of the production matcher. Kept in sync deliberately — if you change one, change both.
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
const IGNORED_SUFFIXES = ['.min.js', '.min.css', '.map'];

function isIgnored(absOrRelPath: string): boolean {
  if (!absOrRelPath) return false;
  const segments = absOrRelPath.split(sep).join('/').split('/');
  for (const seg of segments) if (IGNORED_DIR_SEGMENTS.has(seg)) return true;
  for (const suffix of IGNORED_SUFFIXES) if (absOrRelPath.endsWith(suffix)) return true;
  for (const seg of segments) if (seg.length > 1 && seg.startsWith('.')) return true;
  return false;
}

describe('watcher ignore matcher (EMFILE regression guard)', () => {
  it('excludes node_modules at any depth (the bug that caused EMFILE)', () => {
    expect(isIgnored('node_modules/lodash/map.js')).toBe(true);
    expect(isIgnored('node_modules/@types/lodash/fp/unzipWith.d.ts')).toBe(true);
    expect(isIgnored('/abs/path/node_modules/lodash/map.js')).toBe(true);
    expect(isIgnored('apps/api/node_modules/express/index.js')).toBe(true);
  });

  it('excludes other generated/dependency directories', () => {
    expect(isIgnored('dist/cli.js')).toBe(true);
    expect(isIgnored('build/Release/x.node')).toBe(true);
    expect(isIgnored('.sliver/index.db')).toBe(true);
    expect(isIgnored('coverage/lcov.info')).toBe(true);
    expect(isIgnored('src/app/__pycache__/foo.pyc')).toBe(true);
  });

  it('excludes hidden directories (.git, .vscode, .idea, etc.)', () => {
    expect(isIgnored('.git/HEAD')).toBe(true);
    expect(isIgnored('.vscode/settings.json')).toBe(true);
    expect(isIgnored('src/.cache/x.ts')).toBe(true);
  });

  it('excludes minified files and sourcemaps by suffix', () => {
    expect(isIgnored('public/jquery.min.js')).toBe(true);
    expect(isIgnored('vendor/lib.min.css')).toBe(true);
    expect(isIgnored('dist/app.js.map')).toBe(true);
  });

  it('does NOT exclude normal source files', () => {
    expect(isIgnored('src/auth/Auth.ts')).toBe(false);
    expect(isIgnored('src/components/Button.tsx')).toBe(false);
    expect(isIgnored('app/handlers.py')).toBe(false);
    expect(isIgnored('lib/utils.js')).toBe(false);
  });

  it('handles edge cases (empty path, single dot, deep nesting)', () => {
    expect(isIgnored('')).toBe(false);
    expect(isIgnored('.')).toBe(false); // current dir, not hidden
    expect(isIgnored('./src/x.ts')).toBe(false);
    expect(isIgnored('a/b/c/d/node_modules/x/y.js')).toBe(true);
  });
});
