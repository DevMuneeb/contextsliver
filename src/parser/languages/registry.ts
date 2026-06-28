// Language plugin registry.
//
// A "plugin" maps a language id + file extensions to:
//   - the tree-sitter Language object (for parsing + queries)
//   - the tags.scm query source (loaded at runtime from grammars/)
//
// To add a language (see CONTRIBUTING.md):
//   1. npm install tree-sitter-<lang>
//   2. add grammars/<lang>/tags.scm
//   3. create src/parser/languages/<lang>.ts exporting a LanguagePlugin
//   4. import it in PLUGINS below
//
// loadQuery lives in ./query-loader.ts (NOT here) to avoid a circular import: this module
// imports the plugin modules, which need loadQuery at construction time.
import type { LanguageId } from '../types.js';
import { typescriptPlugin } from './typescript.js';
import { pythonPlugin } from './python.js';

// Re-export so existing `import { loadQuery } from './registry.js'` keeps working.
export { loadQuery } from './query-loader.js';

/** What a language plugin provides. `language` is the tree-sitter Language object (typed loosely). */
export interface LanguagePlugin {
  /** short id stored in files.language, e.g. 'typescript' */
  id: LanguageId;
  /** file extensions (with leading dot) handled by this plugin */
  extensions: string[];
  /** tree-sitter Language object (we accept the native binding shape) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  language: any;
  /** the tags.scm query source */
  query: string;
}

/** All registered plugins, in priority order. */
export const PLUGINS: LanguagePlugin[] = [typescriptPlugin, pythonPlugin];

/** Map of file extension → plugin, for O(1) lookup by extension. */
const EXTENSION_MAP: Map<string, LanguagePlugin> = new Map();
for (const plugin of PLUGINS) {
  for (const ext of plugin.extensions) {
    EXTENSION_MAP.set(ext.toLowerCase(), plugin);
  }
}

/**
 * Resolve a plugin for a file path by its extension, or null if unsupported.
 * (e.g. 'src/auth/Auth.ts' → typescriptPlugin)
 */
export function pluginForFile(filePath: string): LanguagePlugin | null {
  const dot = filePath.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = filePath.slice(dot).toLowerCase();
  return EXTENSION_MAP.get(ext) ?? null;
}

/** Get a plugin by its language id. */
export function pluginById(id: LanguageId): LanguagePlugin | undefined {
  return PLUGINS.find((p) => p.id === id);
}

/** All supported extensions (for the file watcher / indexer). */
export function supportedExtensions(): string[] {
  return Array.from(EXTENSION_MAP.keys());
}
