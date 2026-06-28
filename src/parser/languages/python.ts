// Python language plugin.
//
// tree-sitter-python's default export is an object exposing the Language via both the object
// itself and a .language property (both are accepted by Parser.setLanguage and new Query).
// We pass the object directly — both setLanguage and Query accept it (verified at build time).
import Python from 'tree-sitter-python';
import type { LanguagePlugin } from './registry.js';
import { loadQuery } from './query-loader.js';

export const pythonPlugin: LanguagePlugin = {
  id: 'python',
  extensions: ['.py', '.pyi'],
  language: Python,
  query: loadQuery('python'),
};
