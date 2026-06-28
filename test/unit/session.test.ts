// Session ledger + pruner tests. Mirrors contextsliver-spec.md §9.3.
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SessionManager } from '../../src/session/manager.js';
import { pruneBySession, symbolsToMark } from '../../src/session/pruner.js';
import type { SymbolRow } from '../../src/graph/types.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT UNIQUE, content_hash TEXT, indexed_at INTEGER, language TEXT);
    CREATE TABLE symbols (id INTEGER PRIMARY KEY AUTOINCREMENT, file_id INTEGER REFERENCES files(id) ON DELETE CASCADE, name TEXT, kind TEXT, line_start INTEGER, line_end INTEGER, signature TEXT, package TEXT);
    CREATE TABLE edges (id INTEGER PRIMARY KEY AUTOINCREMENT, from_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE, to_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE, kind TEXT, UNIQUE(from_id, to_id, kind));
    CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at INTEGER, project_root TEXT);
    CREATE TABLE ledger_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE, symbol_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE, content_hash TEXT, sent_at INTEGER, UNIQUE(session_id, symbol_id));
  `);
  return db;
}

/** Seed a real symbol row so the FK in ledger_entries is satisfied. */
function seedSymbol(db: Database.Database, id: number, name: string): void {
  db.prepare(
    'INSERT INTO files (id, path, content_hash, indexed_at, language) VALUES (?, ?, ?, ?, ?)',
  ).run(id, `f${id}.ts`, 'h', Date.now(), 'typescript');
  db.prepare(
    'INSERT INTO symbols (id, file_id, name, kind, line_start, line_end) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, id, name, 'function', 1, 10);
}

function sym(id: number, name: string): SymbolRow {
  return {
    id,
    name,
    kind: 'function',
    file_path: `f${id}.ts`,
    line_start: 1,
    line_end: 10,
    signature: null,
    package: null,
  };
}

describe('SessionManager', () => {
  let db: Database.Database;
  let manager: SessionManager;

  beforeEach(() => {
    db = makeDb();
    manager = new SessionManager(db);
  });

  it('createSession returns a UUID', () => {
    const id = manager.createSession('/project');
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('sessionExists reflects creation', () => {
    const id = manager.createSession('/project');
    expect(manager.sessionExists(id)).toBe(true);
    expect(manager.sessionExists('nope')).toBe(false);
  });

  it('filterAlreadySent returns all symbols as fresh on first call', () => {
    const sessionId = manager.createSession('/project');
    const { fresh, alreadySent } = manager.filterAlreadySent(sessionId, [sym(1, 'A')]);
    expect(fresh).toHaveLength(1);
    expect(alreadySent).toHaveLength(0);
  });

  it('filterAlreadySent excludes symbols already sent this session', () => {
    seedSymbol(db, 1, 'AuthService');
    const sessionId = manager.createSession('/project');

    manager.markAsSent(sessionId, [sym(1, 'AuthService')]);

    const { fresh, alreadySent } = manager.filterAlreadySent(sessionId, [sym(1, 'AuthService')]);
    expect(fresh).toHaveLength(0);
    expect(alreadySent).toHaveLength(1);
    expect(alreadySent[0].name).toBe('AuthService');
  });

  it('keeps sessions independent — symbols sent to one session are fresh in another', () => {
    seedSymbol(db, 1, 'X');
    const s1 = manager.createSession('/project');
    const s2 = manager.createSession('/project');

    manager.markAsSent(s1, [sym(1, 'X')]);

    expect(manager.filterAlreadySent(s1, [sym(1, 'X')]).fresh).toHaveLength(0);
    expect(manager.filterAlreadySent(s2, [sym(1, 'X')]).fresh).toHaveLength(1);
  });

  it('markAsSent is idempotent (UNIQUE constraint)', () => {
    seedSymbol(db, 1, 'Y');
    const s = manager.createSession('/project');
    expect(() => {
      manager.markAsSent(s, [sym(1, 'Y')]);
      manager.markAsSent(s, [sym(1, 'Y')]);
    }).not.toThrow();
    expect(manager.filterAlreadySent(s, [sym(1, 'Y')]).alreadySent).toHaveLength(1);
  });

  it('filterAlreadySent handles an empty input', () => {
    const s = manager.createSession('/project');
    const r = manager.filterAlreadySent(s, []);
    expect(r.fresh).toHaveLength(0);
    expect(r.alreadySent).toHaveLength(0);
  });

  it('cleanOldSessions removes sessions older than 24h', () => {
    // Insert a session dated 2 days ago directly.
    db.prepare(
      'INSERT INTO sessions (id, created_at, project_root) VALUES (?, ?, ?)',
    ).run('old-session', Date.now() - 48 * 60 * 60 * 1000, '/project');

    const removed = manager.cleanOldSessions();
    expect(removed).toBe(1);
    expect(manager.sessionExists('old-session')).toBe(false);
  });
});

describe('pruner', () => {
  let db: Database.Database;
  let manager: SessionManager;

  beforeEach(() => {
    db = makeDb();
    manager = new SessionManager(db);
  });

  it('returns all neighbors fresh on first call and reports none skipped', () => {
    seedSymbol(db, 1, 'Focal');
    seedSymbol(db, 2, 'Caller');
    seedSymbol(db, 3, 'Dep');
    const sid = manager.createSession('/project');

    const pruned = pruneBySession(manager, sid, {
      symbol: sym(1, 'Focal'),
      callers: [sym(2, 'Caller')],
      dependencies: [sym(3, 'Dep')],
    });

    expect(pruned.callers.map((s) => s.name)).toEqual(['Caller']);
    expect(pruned.dependencies.map((s) => s.name)).toEqual(['Dep']);
    expect(pruned.skipped).toHaveLength(0);
  });

  it('skips symbols already sent and lists them in skipped', () => {
    seedSymbol(db, 1, 'Focal');
    seedSymbol(db, 2, 'Caller');
    seedSymbol(db, 3, 'Dep');
    const sid = manager.createSession('/project');

    // Pre-send Caller + Dep
    manager.markAsSent(sid, [sym(2, 'Caller'), sym(3, 'Dep')]);

    const pruned = pruneBySession(manager, sid, {
      symbol: sym(1, 'Focal'),
      callers: [sym(2, 'Caller')],
      dependencies: [sym(3, 'Dep')],
    });

    expect(pruned.callers).toHaveLength(0);
    expect(pruned.dependencies).toHaveLength(0);
    expect(pruned.skipped.sort()).toEqual(['Caller', 'Dep']);
  });

  it('symbolsToMark includes focal + fresh neighbors', () => {
    const pruned: any = {
      symbol: sym(1, 'Focal'),
      callers: [sym(2, 'Caller')],
      dependencies: [sym(3, 'Dep')],
      skipped: [],
    };
    const ids = symbolsToMark(pruned).map((s) => s.id);
    expect(ids.sort()).toEqual([1, 2, 3]);
  });
});
