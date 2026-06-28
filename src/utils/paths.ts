// Path normalization + import-path resolution utilities.
//
// All stored file paths are relative to the project root, posix-style (forward slashes),
// so the index is portable across OSes and the graph query results are stable.
import { resolve, relative, normalize, sep, posix, isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Convert an absolute or project-relative path to a canonical, posix-style, project-relative path.
 * This is the form stored in `files.path` and used in all graph queries.
 *
 * @example toRelativePath('/proj/src/auth/Auth.ts', '/proj') → 'src/auth/Auth.ts'
 */
export function toRelativePath(absoluteOrRelative: string, projectRoot: string): string {
  const abs = isAbsolute(absoluteOrRelative) ? absoluteOrRelative : resolve(projectRoot, absoluteOrRelative);
  const rel = relative(resolve(projectRoot), abs);
  return toPosix(rel);
}

/** Normalize a path to posix separators (forward slashes) and strip leading ./ */
export function toPosix(p: string): string {
  const normalized = sep === '\\' ? p.split(sep).join(posix.sep) : p;
  return normalized.replace(/^\.\//, '').replace(/\\/g, '/');
}

/**
 * Resolve a relative import specifier (e.g. './AuthService', '../utils') against the importing
 * file's directory, trying the common extensions. Returns a posix project-relative path, or
 * null if no candidate file exists on disk.
 *
 * Bare specifiers (e.g. 'react', '@myorg/ui') are NOT resolved here — monorepo/workspace
 * resolution handles those separately. Node built-ins ('node:fs', 'fs') never resolve to a file.
 *
 * @param specifier - the import path as written in source
 * @param importerRel - posix project-relative path of the file doing the import
 * @param projectRoot - absolute project root, for existence checks
 * @param extensions - candidate extensions to try (with and without /index)
 */
export function resolveRelativeImport(
  specifier: string,
  importerRel: string,
  projectRoot: string,
  extensions: string[] = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
): string | null {
  if (!specifier.startsWith('.')) return null; // bare or builtin
  const importerDir = posix.dirname(importerRel);
  const base = toPosix(normalize(posix.join(importerDir, specifier)));

  // Try the specifier as-is with each extension, then /index.<ext>
  const candidates = [base, ...extensions.map((ext) => base + ext)];
  for (const ext of extensions) {
    candidates.push(posix.join(base, 'index' + ext));
  }

  for (const candidate of candidates) {
    if (candidate.startsWith('..')) continue; // escaped project root
    const abs = resolve(projectRoot, candidate);
    if (existsSync(abs)) return candidate;
  }
  return null;
}
