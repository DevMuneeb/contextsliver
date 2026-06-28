// Pruner: higher-level delta helpers built on SessionManager.
//
// While SessionManager.filterAlreadySent does the raw split, the pruner layers on the
// "build the final response payload" concern: given a traversal result and a session, return
// only the fresh callers/dependencies plus the list of names skipped (for the already_in_context
// hint). This keeps the MCP tool handlers thin.
import type { SymbolRow } from '../graph/types.js';
import type { SessionManager } from './manager.js';

export interface PrunedContext {
  /** callers not yet sent this session */
  callers: SymbolRow[];
  /** dependencies not yet sent this session */
  dependencies: SymbolRow[];
  /** focal symbol (always included, even if re-sent, so the agent knows what was queried) */
  symbol: SymbolRow;
  /** names of symbols skipped because already in context */
  skipped: string[];
}

/**
 * Apply session dedup to a traversal result. Does NOT mark anything as sent — the caller does
 * that via sessionManager.markAsSent after building the final response (so a failed/errored
 * tool call doesn't pollute the ledger).
 */
export function pruneBySession(
  sessionManager: SessionManager,
  sessionId: string,
  traversal: {
    symbol: SymbolRow;
    callers: SymbolRow[];
    dependencies: SymbolRow[];
  },
): PrunedContext {
  const { fresh: freshCallers, alreadySent: sentCallers } = sessionManager.filterAlreadySent(
    sessionId,
    traversal.callers,
  );
  const { fresh: freshDeps, alreadySent: sentDeps } = sessionManager.filterAlreadySent(
    sessionId,
    traversal.dependencies,
  );

  const skipped = [...sentCallers, ...sentDeps].map((s) => s.name);

  return {
    symbol: traversal.symbol,
    callers: freshCallers,
    dependencies: freshDeps,
    skipped,
  };
}

/**
 * Collect every symbol id that would be "sent" in a pruned context, for markAsSent.
 * Includes the focal symbol (always part of the response).
 */
export function symbolsToMark(pruned: PrunedContext): SymbolRow[] {
  return [pruned.symbol, ...pruned.callers, ...pruned.dependencies];
}
