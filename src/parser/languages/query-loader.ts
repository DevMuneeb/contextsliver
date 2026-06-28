// Standalone tags.scm loader. Kept separate from registry.ts to avoid a circular import:
// registry.ts imports the plugin modules, which import loadQuery from here (not from registry).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Load a tags.scm query file from the grammars/ directory.
 *
 * Resolves relative to the compiled module location so it works both during development
 * (src/ → grammars/) and after publish (dist/ → grammars/, since grammars/ is in package.json
 * "files"). We walk up from the current file to find the package root (the dir containing
 * grammars/).
 */
export function loadQuery(languageId: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dev:  src/parser/languages/query-loader.ts → ../../../grammars
  // ship: dist/parser/languages/query-loader.js → ../../../grammars
  const candidates = [
    resolve(here, '..', '..', '..', 'grammars', languageId, 'tags.scm'),
    resolve(here, '..', '..', 'grammars', languageId, 'tags.scm'),
    resolve(process.cwd(), 'grammars', languageId, 'tags.scm'),
  ];
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, 'utf-8');
    } catch {
      // try next
    }
  }
  throw new Error(
    `Could not find grammars/${languageId}/tags.scm (looked in ${candidates.join(', ')})`,
  );
}
