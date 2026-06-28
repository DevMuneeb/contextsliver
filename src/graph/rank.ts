// Symbol importance ranking.
//
// v0.1: identity pass-through — symbols are returned in graph/BFS order (no re-ranking).
// This module exists so the v0.5 PageRank-style scoring can land without touching callers.
// When implemented, `rankSymbols` will re-order a list of symbols by importance (in-degree,
// PageRank over the call graph) so that budget-limited responses prioritize central symbols.
import type { SymbolRow } from './types.js';

/**
 * Rank symbols by importance. v0.1 stub: returns the input unchanged.
 *
 * TODO (v0.5): implement PageRank-style scoring over the symbol graph. Until then the
 * traversal order (BFS, nearest-first) is a reasonable default.
 */
export function rankSymbols(symbols: SymbolRow[]): SymbolRow[] {
  return symbols;
}
