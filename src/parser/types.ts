// Parser types: the in-memory shape of what Tree-sitter extracts from a file, BEFORE it's
// written to the graph. The extractor produces a ParseResult; indexRepository resolves
// imports into edges and persists symbols + edges via GraphStore.
import type { SymbolKind, EdgeKind } from '../graph/types.js';

/** A symbol extracted from source (not yet persisted). */
export interface ExtractedSymbol {
  name: string;
  kind: SymbolKind;
  line_start: number; // 1-based, inclusive
  line_end: number; // 1-based, inclusive
  /** condensed definition: e.g. "function login(user: string): Token" — NOT the body */
  signature: string | null;
  /** base/inherited names referenced by a class (for extends/implements edges) */
  extends?: string[];
  implements?: string[];
}

/** A reference from this file to something outside it (an import). */
export interface ExtractedImport {
  /** the raw specifier as written: './AuthService', '../utils', 'react', '@myorg/ui' */
  specifier: string;
  /** names brought in: ['AuthService', 'TokenService'] (best-effort; may be empty for namespace imports) */
  names: string[];
}

/** Full extraction output for one file. */
export interface ParseResult {
  symbols: ExtractedSymbol[];
  imports: ExtractedImport[];
}

/** Edge between two symbols, as the indexer builds it. */
export interface PendingEdge {
  /** symbol-local name of the source (the importer/caller) */
  fromName: string;
  /** name the edge points to (an imported or referenced name) */
  toName: string;
  kind: EdgeKind;
}

/** Supported language identifiers (stored in files.language). */
export type LanguageId = 'typescript' | 'javascript' | 'python';
