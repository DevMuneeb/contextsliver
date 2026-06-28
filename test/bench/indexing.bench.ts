// Indexing benchmark (run with: npm run test:bench).
//
// Targets (from contextsliver-spec.md §9.5):
//   500-file TypeScript repo  → indexes in < 5 seconds
//   5,000-file TypeScript repo → indexes in < 30 seconds
//
// The hard regression guard (500-file must finish in a generous multiple of target) lives in
// test/unit/performance.test.ts so it runs in the normal `npm test` suite on every PR.
import { bench, describe } from 'vitest';
import Database from 'better-sqlite3';
import { GraphStore } from '../../src/graph/store.js';
import { indexRepository } from '../../src/parser/index.js';
import { generateFixture, cleanupFixture } from '../helpers/fixture-generator.js';

describe('indexing performance', () => {
  bench(
    '500-file TypeScript repo',
    () => {
      const dir = generateFixture({ files: 500 });
      try {
        const store = new GraphStore(new Database(':memory:'));
        indexRepository(store, dir, { force: true });
      } finally {
        cleanupFixture(dir);
      }
    },
    { iterations: 3, warmupIterations: 1 },
  );

  bench(
    '5,000-file TypeScript repo',
    () => {
      const dir = generateFixture({ files: 5000 });
      try {
        const store = new GraphStore(new Database(':memory:'));
        indexRepository(store, dir, { force: true });
      } finally {
        cleanupFixture(dir);
      }
    },
    { iterations: 1, warmupIterations: 0 },
  );
});
