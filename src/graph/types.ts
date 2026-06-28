// Shared graph types. These describe the rows that come back from SQLite queries,
// plus the public traversal result shape returned to the MCP tools.

/** A row of the `symbols` table joined with its owning file path. */
export interface SymbolRow {
  id: number;
  name: string;
  kind: SymbolKind;
  /** posix project-relative path of the file containing this symbol */
  file_path: string;
  file_id?: number;
  line_start: number;
  line_end: number;
  signature: string | null;
  package: string | null;
}

export type SymbolKind = 'function' | 'class' | 'interface' | 'variable' | 'type';

/** Edge kinds (see `edges.kind`). */
export type EdgeKind = 'calls' | 'imports' | 'extends' | 'implements' | 'uses';

/** A directed edge between two symbols. */
export interface EdgeRow {
  id: number;
  from_id: number;
  to_id: number;
  kind: EdgeKind;
}

/** A row of the `files` table. */
export interface FileRow {
  id: number;
  path: string;
  content_hash: string;
  indexed_at: number;
  language: string;
}

/** Compact representation returned by MCP tools (no internal ids leaked). */
export interface SymbolRef {
  name: string;
  file: string;
  kind: string;
  signature?: string | null;
}

/** Result of a blast-radius traversal — the core query for cs_blast_radius / cs_get_context. */
export interface TraversalResult {
  symbol: SymbolRow;
  /** who uses this symbol (reverse edges) */
  callers: SymbolRow[];
  /** what this symbol uses (forward edges) */
  dependencies: SymbolRow[];
  depth: number;
}
