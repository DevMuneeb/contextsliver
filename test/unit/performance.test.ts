// Performance regression guard. Runs in the normal `npm test` suite (unlike the .bench file,
// which only runs under `npm run test:bench`).
//
// Asserts the 500-file indexing target from contextsliver-spec.md §9.5, with generous headroom
// (CI runners vary). A 4x regression would still trip this, catching gross perf degradation.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { GraphStore } from '../../src/graph/store.js';
import { indexRepository } from '../../src/parser/index.js';
import { generateFixture, cleanupFixture } from '../helpers/fixture-generator.js';

describe('indexing performance regression guard', () => {
  it('500-file TypeScript repo indexes within target (< 20s, 4x the 5s goal)', () => {
    const dir = generateFixture({ files: 500 });
    try {
      const store = new GraphStore(new Database(':memory:'));
      const start = Date.now();
      const result = indexRepository(store, dir, { force: true });
      const elapsed = Date.now() - start;

      // Sanity: actually parsed all files.
      expect(result.filesIndexed).toBe(500);
      expect(result.symbols).toBeGreaterThan(0);

      // Performance guard. The spec target is 5s; allow 4x for CI variance.
      expect(elapsed).toBeLessThan(20000);
    } finally {
      cleanupFixture(dir);
    }
  }, 60000);
});
