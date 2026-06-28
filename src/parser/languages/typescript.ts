// TypeScript / JavaScript / TSX language plugin.
//
// tree-sitter-typescript exports two grammars: { typescript, tsx }. JavaScript uses the
// typescript grammar's JS subset, but for accurate JS parsing we'd want tree-sitter-javascript.
// For v0.1 we parse .js with the typescript grammar (superset — works fine for symbol extraction).
import TS from 'tree-sitter-typescript';
import type { LanguagePlugin } from './registry.js';
import { loadQuery } from './query-loader.js';

// The package exports { typescript, tsx }. Use tsx for .tsx so JSX parses.
const tsGrammar = (TS as { typescript: unknown }).typescript;
const tsxGrammar = (TS as { tsx: unknown }).tsx;

/**
 * Single plugin object covering .ts/.tsx/.js/.jsx/.mjs/.cjs. The query is shared; the grammar
 * differs for tsx vs the rest (set per-file in the extractor via parse()).
 */
export const typescriptPlugin: LanguagePlugin = {
  id: 'typescript',
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  language: tsGrammar,
  query: loadQuery('typescript'),
};

/** Choose the right grammar object for a specific TS-family file (tsx vs non-tsx). */
export function typescriptGrammarForFile(filePath: string): unknown {
  return filePath.toLowerCase().endsWith('.tsx') ? tsxGrammar : tsGrammar;
}

export { tsxGrammar };
