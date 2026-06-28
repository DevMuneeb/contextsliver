// Graph traversal tests — bidirectional BFS + cycle detection.
// Mirrors contextsliver-spec.md §9.2, exercising blastRadius against an in-memory DB.
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { blastRadius } from '../../src/graph/traverse.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT UNIQUE, content_hash TEXT, indexed_at INTEGER, language TEXT);
    CREATE TABLE symbols (id INTEGER PRIMARY KEY AUTOINCREMENT, file_id INTEGER REFERENCES files(id) ON DELETE CASCADE, name TEXT, kind TEXT, line_start INTEGER, line_end INTEGER, signature TEXT, package TEXT);
    CREATE TABLE edges (id INTEGER PRIMARY KEY AUTOINCREMENT, from_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE, to_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE, kind TEXT, UNIQUE(from_id, to_id, kind));
  `);
  return db;
}

function seedFile(db: Database.Database, path = 'src/test.ts'): number {
  return db
    .prepare('INSERT INTO files (path, content_hash, indexed_at, language) VALUES (?, ?, ?, ?)')
    .run(path, 'h' + Math.random(), Date.now(), 'typescript').lastInsertRowid as number;
}

function seedSymbol(db: Database.Database, name: string, fileId?: number): number {
  const fid = fileId ?? seedFile(db);
  return db
    .prepare(
      'INSERT INTO symbols (file_id, name, kind, line_start, line_end) VALUES (?, ?, ?, ?, ?)',
    )
    .run(fid, name, 'function', 1, 10).lastInsertRowid as number;
}

function edge(db: Database.Database, from: number, to: number, kind = 'calls'): void {
  db.prepare('INSERT INTO edges (from_id, to_id, kind) VALUES (?, ?, ?)').run(from, to, kind);
}

describe('blastRadius traversal', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  it('returns null for a nonexistent symbol id', () => {
    expect(blastRadius(db, 999999, 2)).toBeNull();
  });

  it('returns direct callers and dependencies', () => {
    const file = seedFile(db);
    const authId = seedSymbol(db, 'AuthService', file);
    const middlewareId = seedSymbol(db, 'AuthMiddleware', file);
    const userRepoId = seedSymbol(db, 'UserRepository', file);

    // AuthMiddleware calls AuthService  (so AuthMiddleware is a caller)
    edge(db, middlewareId, authId);
    // AuthService calls UserRepository   (so UserRepository is a dependency)
    edge(db, authId, userRepoId);

    const result = blastRadius(db, authId, 2);

    expect(result).not.toBeNull();
    expect(result!.symbol.name).toBe('AuthService');
    expect(result!.symbol.file_path).toBe('src/test.ts');
    expect(result!.callers.map((s) => s.name)).toContain('AuthMiddleware');
    expect(result!.dependencies.map((s) => s.name)).toContain('UserRepository');
  });

  it('terminates on circular dependency graphs — never infinite loops', () => {
    const file = seedFile(db);
    const a = seedSymbol(db, 'A', file);
    const b = seedSymbol(db, 'B', file);
    const c = seedSymbol(db, 'C', file);

    // A → B → C → A (circular)
    edge(db, a, b);
    edge(db, b, c);
    edge(db, c, a);

    // Must complete without throwing or hanging.
    expect(() => blastRadius(db, a, 4)).not.toThrow();
    const result = blastRadius(db, a, 4);
    expect(result).not.toBeNull();
    // With a 3-node cycle, B and C are both reachable as dependencies of A.
    const depNames = result!.dependencies.map((s) => s.name).sort();
    expect(depNames).toEqual(['B', 'C']);
  });

  it('respects max_depth — does not return symbols beyond the depth cap', () => {
    const file = seedFile(db);
    // Chain: A → B → C → D → E
    const ids = ['A', 'B', 'C', 'D', 'E'].map((n) => seedSymbol(db, n, file));
    for (let i = 0; i < ids.length - 1; i++) {
      edge(db, ids[i], ids[i + 1]);
    }

    const result = blastRadius(db, ids[0], 2);
    const depNames = result!.dependencies.map((s) => s.name);

    expect(depNames).toContain('B'); // depth 1
    expect(depNames).toContain('C'); // depth 2
    expect(depNames).not.toContain('D'); // depth 3 — beyond cap
    expect(depNames).not.toContain('E');
  });

  it('returns the focal symbol enriched with file path', () => {
    const file = seedFile(db, 'src/deep/Foo.ts');
    const fooId = seedSymbol(db, 'Foo', file);

    const result = blastRadius(db, fooId, 1);
    expect(result!.symbol.name).toBe('Foo');
    expect(result!.symbol.file_path).toBe('src/deep/Foo.ts');
  });

  it('handles a symbol with no edges (isolated node)', () => {
    const file = seedFile(db);
    const lone = seedSymbol(db, 'Lone', file);

    const result = blastRadius(db, lone, 2);
    expect(result!.callers).toHaveLength(0);
    expect(result!.dependencies).toHaveLength(0);
  });
});
