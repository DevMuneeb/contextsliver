// Hasher + dirty-flag logic tests.
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { GraphStore } from '../../src/graph/store.js';
import { hashContent, isDirty } from '../../src/watcher/hasher.js';

function makeStore(): GraphStore {
  const db = new Database(':memory:');
  return new GraphStore(db);
}

describe('hasher', () => {
  let store: GraphStore;

  beforeEach(() => {
    store = makeStore();
  });

  it('hashContent is deterministic and stable', () => {
    expect(hashContent('hello')).toBe(hashContent('hello'));
    expect(hashContent('hello')).not.toBe(hashContent('world'));
    expect(hashContent('hello')).toHaveLength(64); // sha-256 hex
  });

  it('isDirty returns true for a file not yet indexed', () => {
    expect(isDirty(store, 'src/new.ts', hashContent('x'))).toBe(true);
  });

  it('isDirty returns false when the hash matches the stored hash', () => {
    const h = hashContent('content');
    store.upsertFile('src/a.ts', h, 'typescript');
    expect(isDirty(store, 'src/a.ts', h)).toBe(false);
  });

  it('isDirty returns true when content changed', () => {
    store.upsertFile('src/a.ts', hashContent('old'), 'typescript');
    expect(isDirty(store, 'src/a.ts', hashContent('new'))).toBe(true);
  });

  it('hashContent handles unicode + multiline input', () => {
    expect(() => hashContent('héllo\nwörld\n©')).not.toThrow();
    expect(hashContent('héllo\nwörld\n©')).toHaveLength(64);
  });
});
