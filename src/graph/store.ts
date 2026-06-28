// Graph store: all SQLite read/write operations for files, symbols, and edges.
//
// This is the only module that touches the symbols/edges/files tables directly (the session
// ledger has its own manager). Keeps prepared statements cached for performance.
//
// Write path (parser → indexRepository):
//   upsertFile → deleteFileSymbols → insertSymbol (×N) → insertEdge (×N)
// all wrapped in a transaction per file for atomicity.
import type Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';
import type { SymbolRow, EdgeKind, FileRow } from './types.js';

export class GraphStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(SCHEMA_SQL);
  }

  // ── files ──────────────────────────────────────────────────────────────────

  /** Insert or replace a file row. Returns the file id. */
  upsertFile(path: string, contentHash: string, language: string): number {
    const stmt = this.db.prepare(`
      INSERT INTO files (path, content_hash, indexed_at, language)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        content_hash = excluded.content_hash,
        indexed_at   = excluded.indexed_at,
        language     = excluded.language
      RETURNING id
    `);
    const row = stmt.get(path, contentHash, Date.now(), language) as { id: number } | undefined;
    if (!row) {
      // RETURNING not matched (shouldn't happen) — fall back to SELECT
      return this.getFileId(path)!;
    }
    return row.id;
  }

  getFileId(path: string): number | undefined {
    const row = this.db.prepare('SELECT id FROM files WHERE path = ?').get(path) as
      | { id: number }
      | undefined;
    return row?.id;
  }

  getFile(path: string): FileRow | undefined {
    return this.db
      .prepare('SELECT id, path, content_hash, indexed_at, language FROM files WHERE path = ?')
      .get(path) as FileRow | undefined;
  }

  /** Delete a file and cascade-delete its symbols (and their edges via ON DELETE CASCADE). */
  deleteFile(path: string): void {
    this.db.prepare('DELETE FROM files WHERE path = ?').run(path);
  }

  /** All indexed files. Used for full re-index accounting. */
  countFiles(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM files').get() as { n: number };
    return row.n;
  }

  /** Hash of a file's content as stored at last index, or undefined if not indexed. */
  getFileHash(path: string): string | undefined {
    const row = this.db.prepare('SELECT content_hash FROM files WHERE path = ?').get(path) as
      | { content_hash: string }
      | undefined;
    return row?.content_hash;
  }

  // ── symbols ────────────────────────────────────────────────────────────────

  /** Insert a symbol for a file. Returns the new symbol id. */
  insertSymbol(sym: {
    file_id: number;
    name: string;
    kind: string;
    line_start: number;
    line_end: number;
    signature: string | null;
    package: string | null;
  }): number {
    const stmt = this.db.prepare(`
      INSERT INTO symbols (file_id, name, kind, line_start, line_end, signature, package)
      VALUES (@file_id, @name, @kind, @line_start, @line_end, @signature, @package)
      RETURNING id
    `);
    const row = stmt.get(sym) as { id: number };
    return row.id;
  }

  /** Remove all symbols belonging to a file (edges cascade). Used before re-inserting. */
  deleteFileSymbols(fileId: number): void {
    this.db.prepare('DELETE FROM symbols WHERE file_id = ?').run(fileId);
  }

  /** Find a symbol by exact name (first match). Returns the enriched SymbolRow. */
  findSymbolByName(name: string): SymbolRow | undefined {
    return this.db
      .prepare(
        `SELECT s.id, s.name, s.kind, s.file_id, s.line_start, s.line_end, s.signature, s.package,
                f.path AS file_path
         FROM symbols s JOIN files f ON f.id = s.file_id
         WHERE s.name = ?
         LIMIT 1`,
      )
      .get(name) as SymbolRow | undefined;
  }

  /** All symbols matching a name (names are not globally unique). */
  findSymbolsByName(name: string): SymbolRow[] {
    return this.db
      .prepare(
        `SELECT s.id, s.name, s.kind, s.file_id, s.line_start, s.line_end, s.signature, s.package,
                f.path AS file_path
         FROM symbols s JOIN files f ON f.id = s.file_id
         WHERE s.name = ?`,
      )
      .all(name) as SymbolRow[];
  }

  /** Full-row symbol by id (joined with file path). */
  getSymbol(id: number): SymbolRow | undefined {
    return this.db
      .prepare(
        `SELECT s.id, s.name, s.kind, s.file_id, s.line_start, s.line_end, s.signature, s.package,
                f.path AS file_path
         FROM symbols s JOIN files f ON f.id = s.file_id
         WHERE s.id = ?`,
      )
      .get(id) as SymbolRow | undefined;
  }

  /** FTS-lite substring search across symbol name + file path. Used by cs_search_symbols. */
  searchSymbols(query: string, limit: number): SymbolRow[] {
    const like = `%${query.replace(/[%_]/g, (m) => '\\' + m)}%`;
    return this.db
      .prepare(
        `SELECT s.id, s.name, s.kind, s.file_id, s.line_start, s.line_end, s.signature, s.package,
                f.path AS file_path
         FROM symbols s JOIN files f ON f.id = s.file_id
         WHERE s.name LIKE ? ESCAPE '\\' OR f.path LIKE ? ESCAPE '\\'
         ORDER BY
           CASE WHEN s.name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END,
           s.name
         LIMIT ?`,
      )
      .all(like, like, like, limit) as SymbolRow[];
  }

  /** Look up a symbol by name within a specific file (for import resolution). */
  findSymbolInFile(fileId: number, name: string): SymbolRow | undefined {
    return this.db
      .prepare(
        `SELECT s.id, s.name, s.kind, s.file_id, s.line_start, s.line_end, s.signature, s.package,
                f.path AS file_path
         FROM symbols s JOIN files f ON f.id = s.file_id
         WHERE s.file_id = ? AND s.name = ?
         LIMIT 1`,
      )
      .get(fileId, name) as SymbolRow | undefined;
  }

  // ── edges ───────────────────────────────────────────────────────────────────

  /** Insert an edge (UNIQUE constraint dedupes on from/to/kind). Ignores if exists. */
  insertEdge(fromId: number, toId: number, kind: EdgeKind): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO edges (from_id, to_id, kind) VALUES (?, ?, ?)',
      )
      .run(fromId, toId, kind);
  }

  /** Symbols this symbol points to (forward edges), any kind. */
  getDependencies(symbolId: number): SymbolRow[] {
    return this.db
      .prepare(
        `SELECT s.id, s.name, s.kind, s.file_id, s.line_start, s.line_end, s.signature, s.package,
                f.path AS file_path
         FROM edges e JOIN symbols s ON s.id = e.to_id JOIN files f ON f.id = s.file_id
         WHERE e.from_id = ?`,
      )
      .all(symbolId) as SymbolRow[];
  }

  /** Symbols that point to this one (reverse edges), any kind. */
  getCallers(symbolId: number): SymbolRow[] {
    return this.db
      .prepare(
        `SELECT s.id, s.name, s.kind, s.file_id, s.line_start, s.line_end, s.signature, s.package,
                f.path AS file_path
         FROM edges e JOIN symbols s ON s.id = e.from_id JOIN files f ON f.id = s.file_id
         WHERE e.to_id = ?`,
      )
      .all(symbolId) as SymbolRow[];
  }

  // ── misc ────────────────────────────────────────────────────────────────────

  /** Run a function inside a DB transaction (batches writes). */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /** Expose the raw db for traversal/manager modules that need their own prepared statements. */
  get raw(): Database.Database {
    return this.db;
  }

  /** Index health stats for cs_index_status. */
  stats(): { files: number; symbols: number; edges: number; lastIndexedAt: number | null } {
    const row = this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM files)   AS files,
           (SELECT COUNT(*) FROM symbols) AS symbols,
           (SELECT COUNT(*) FROM edges)   AS edges,
           (SELECT MAX(indexed_at) FROM files) AS lastIndexedAt`,
      )
      .get() as { files: number; symbols: number; edges: number; lastIndexedAt: number | null };
    return row;
  }
}
