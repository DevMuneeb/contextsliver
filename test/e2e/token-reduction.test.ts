// E2E token-reduction test (scaffold).
//
// CONTEXT: the spec's headline claim is that ContextSliver cuts token usage vs naive cat/grep.
// This test is the place to PROVE that empirically: take a fixed task on a known fixture,
// simulate "naive" context gathering (read whole files) vs "contextsliver" (cs_get_context +
// cs_blast_radius), and compare token counts.
//
// WHY IT'S SKIPPED in v0.1: a rigorous, fair comparison needs (a) a representative multi-file
// fixture, (b) a scripted task that decides which files a naive agent would read, and (c) a
// stable definition of "equivalent context delivered". That methodology work is scheduled for
// the v0.4 token-measurement milestone (see contextsliver-spec.md §12). This scaffold shows
// the shape and the assertion so it's ready to fill in.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { GraphStore } from '../../src/graph/store.js';
import { indexRepository } from '../../src/parser/index.js';
import { generateFixture, cleanupFixture } from '../helpers/fixture-generator.js';
import { countTokens } from '../../src/utils/tokens.js';

describe.skip('token reduction: ContextSliver vs naive file reads (v0.4)', () => {
  it('delivers equivalent context for a symbol lookup in fewer tokens than cat', () => {
    const dir = generateFixture({ files: 50 });
    try {
      const store = new GraphStore(new Database(':memory:'));
      indexRepository(store, dir, { force: true });

      const sym = store.findSymbolByName('Mod25');
      expect(sym).toBeDefined();

      // Naive: an agent reads the whole file containing the symbol.
      // (In the real test, read the file from disk and count its tokens.)
      const naiveText = '...whole file contents...';
      const naiveTokens = countTokens(naiveText);

      // ContextSliver: the focused subgraph (definition + callers + dependencies).
      const sliverText = JSON.stringify({
        symbol: sym!.name,
        file: sym!.file_path,
        callers: [],
        dependencies: [],
      });
      const sliverTokens = countTokens(sliverText);

      // The headline claim: focused context is cheaper than whole-file reads.
      expect(sliverTokens).toBeLessThan(naiveTokens);
    } finally {
      cleanupFixture(dir);
    }
  });
});
