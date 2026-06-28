// SQLite schema for the ContextSliver index.
// Run once on init via `db.exec(SCHEMA_SQL)` — fully idempotent (IF NOT EXISTS).
//
// All four tables live in a single .sliver/index.db file:
//   files          — one row per indexed source file
//   symbols        — one row per extracted symbol (function/class/interface/...)
//   edges          — directed symbol→symbol relationships (calls/imports/extends/...)
//   sessions + ledger_entries — per-session record of what context was already sent
//
// See contextsliver-spec.md §6 for the design rationale (SQLite + recursive CTEs,
// WAL mode for concurrent watcher/server access).

export const SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  -- One row per indexed file
  CREATE TABLE IF NOT EXISTS files (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    path         TEXT    NOT NULL UNIQUE,   -- relative to project root, posix-style
    content_hash TEXT    NOT NULL,          -- SHA-256 of file content
    indexed_at   INTEGER NOT NULL,          -- unix timestamp (ms)
    language     TEXT    NOT NULL           -- 'typescript' | 'python' | ...
  );

  -- One row per extracted symbol (function, class, interface, variable, type)
  CREATE TABLE IF NOT EXISTS symbols (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id    INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,            -- e.g. 'AuthService'
    kind       TEXT    NOT NULL,            -- 'function' | 'class' | 'interface' | 'variable' | 'type'
    line_start INTEGER NOT NULL,
    line_end   INTEGER NOT NULL,
    signature  TEXT,                        -- condensed definition (name + params), not full body
    package    TEXT                         -- monorepo: owning package name (v0.3)
  );

  CREATE INDEX IF NOT EXISTS idx_symbols_name    ON symbols(name);
  CREATE INDEX IF NOT EXISTS idx_symbols_file_id ON symbols(file_id);
  CREATE INDEX IF NOT EXISTS idx_symbols_package ON symbols(package);

  -- Directed edges: symbol A references symbol B
  CREATE TABLE IF NOT EXISTS edges (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    to_id   INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    kind    TEXT    NOT NULL,              -- 'calls' | 'imports' | 'extends' | 'implements' | 'uses'
    UNIQUE(from_id, to_id, kind)
  );

  CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
  CREATE INDEX IF NOT EXISTS idx_edges_to   ON edges(to_id);

  -- Session ledger: what was already sent in each agent session
  CREATE TABLE IF NOT EXISTS sessions (
    id           TEXT    PRIMARY KEY,       -- UUID
    created_at   INTEGER NOT NULL,
    project_root TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ledger_entries (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    symbol_id     INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    content_hash  TEXT    NOT NULL,          -- hash of what was sent at the time
    sent_at       INTEGER NOT NULL,
    UNIQUE(session_id, symbol_id)
  );

  CREATE INDEX IF NOT EXISTS idx_ledger_session ON ledger_entries(session_id);
`;

/** Languages currently supported by the index. Matches parser/languages/registry.ts. */
export const SCHEMA_VERSION = 1;
