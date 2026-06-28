// Indexer integration test: indexRepository over a temp multi-file project, verifying symbols
// land in the store and cross-file import edges resolve. This exercises the full pipeline
// (walker → extractor → store → edge resolution) end to end.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GraphStore } from '../../src/graph/store.js';
import { indexRepository, indexFile } from '../../src/parser/index.js';
import { hashContent } from '../../src/watcher/hasher.js';

function makeStore(): GraphStore {
  return new GraphStore(new Database(':memory:'));
}

describe('indexRepository', () => {
  let dir: string;
  let store: GraphStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sliver-idx-'));
    store = makeStore();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('indexes a small multi-file TS project with import + inheritance edges', () => {
    mkdirSync(join(dir, 'src', 'auth'), { recursive: true });
    mkdirSync(join(dir, 'src', 'users'), { recursive: true });
    // base.ts — exports a class others extend
    writeFileSync(
      join(dir, 'src', 'users', 'Base.ts'),
      `export class Base { id() { return 1; } }\n`,
    );
    // User.ts — exports User, imports nothing
    writeFileSync(join(dir, 'src', 'users', 'User.ts'), `export class User {}\n`);
    // AuthService.ts — imports User, extends Base
    writeFileSync(
      join(dir, 'src', 'auth', 'AuthService.ts'),
      `import { User } from '../users/User';\nimport { Base } from '../users/Base';\nexport class AuthService extends Base {\n  login(u: User) { return u; }\n}\n`,
    );

    const result = indexRepository(store, dir, { force: true });

    expect(result.filesIndexed).toBe(3);
    expect(result.symbols).toBeGreaterThan(0);
    expect(result.edges).toBeGreaterThanOrEqual(2); // at least the import + extends

    // AuthService should have a caller/dependency relationship via blast radius
    const auth = store.findSymbolByName('AuthService');
    expect(auth).toBeDefined();
    const deps = store.getDependencies(auth!.id);
    // 'extends Base' edge and/or 'imports' edge should connect to Base
    const depNames = deps.map((d) => d.name);
    expect(depNames).toContain('Base');
  });

  it('skips unchanged files on a second index (hash dedup)', () => {
    writeFileSync(join(dir, 'a.ts'), `export const X = 1;\n`);
    indexRepository(store, dir, { force: true });
    const r2 = indexRepository(store, dir); // no force
    expect(r2.filesIndexed).toBe(0);
    expect(r2.filesSkipped).toBe(1);
  });

  it('re-indexes a changed file', () => {
    const f = join(dir, 'a.ts');
    writeFileSync(f, `export const X = 1;\n`);
    indexRepository(store, dir, { force: true });
    writeFileSync(f, `export const Y = 2;\n`);
    const r2 = indexRepository(store, dir);
    expect(r2.filesIndexed).toBe(1);
    // X is gone, Y is present
    expect(store.findSymbolByName('Y')).toBeDefined();
    expect(store.findSymbolByName('X')).toBeUndefined();
  });

  it('ignores node_modules / dist / .git', () => {
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'pkg', 'x.ts'), `export const NOPE = 1;\n`);
    writeFileSync(join(dir, 'dist', 'y.ts'), `export const ALSO_NOPE = 1;\n`);
    writeFileSync(join(dir, 'real.ts'), `export const REAL = 1;\n`);

    indexRepository(store, dir, { force: true });
    expect(store.findSymbolByName('REAL')).toBeDefined();
    expect(store.findSymbolByName('NOPE')).toBeUndefined();
    expect(store.findSymbolByName('ALSO_NOPE')).toBeUndefined();
  });

  it('indexFile persists a single file', () => {
    const f = join(dir, 'solo.ts');
    writeFileSync(f, `export function hello() { return 1; }\n`);
    const src = `export function hello() { return 1; }\n`;
    const result = indexFile(store, dir, f, src, hashContent(src));
    expect(result).not.toBeNull();
    expect(store.findSymbolByName('hello')).toBeDefined();
  });
});
