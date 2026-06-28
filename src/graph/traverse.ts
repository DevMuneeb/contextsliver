// Graph traversal: bidirectional BFS from a focal symbol, with cycle detection.
//
// This is the core query powering cs_blast_radius and cs_get_context. It returns:
//   - the focal symbol
//   - callers:      who references this symbol (reverse edges, "who uses it")
//   - dependencies: what this symbol references (forward edges, "what it uses")
//
// Cycle safety: a visited set prevents infinite loops on circular dependency graphs
// (very common in TypeScript). The traversal uses an explicit queue (NOT recursion) so it
// cannot overflow the stack on deep or cyclic graphs. See test/unit/graph.test.ts for the
// circular-dependency fixture that pins this behavior.
import type Database from 'better-sqlite3';
import type { SymbolRow, TraversalResult } from './types.js';

/**
 * Compute the blast radius around a symbol up to maxDepth hops.
 *
 * @param db  - the open SQLite database
 * @param symbolId - focal symbol id
 * @param maxDepth - max hops (default 2). Clamped to [1, 4] by callers.
 * @returns the focal symbol + callers + dependencies, or null if symbol not found.
 */
export function blastRadius(
  db: Database.Database,
  symbolId: number,
  maxDepth: number = 2,
): TraversalResult | null {
  const focal = getSymbolJoined(db, symbolId);
  if (!focal) return null;

  const dependencies = bfsForward(db, symbolId, maxDepth);
  const callers = bfsReverse(db, symbolId, maxDepth);

  return { symbol: focal, callers, dependencies, depth: maxDepth };
}

/** Get a symbol joined with its file path. */
function getSymbolJoined(db: Database.Database, symbolId: number): SymbolRow | undefined {
  return db
    .prepare(
      `SELECT s.id, s.name, s.kind, s.file_id, s.line_start, s.line_end, s.signature, s.package,
              f.path AS file_path
       FROM symbols s JOIN files f ON f.id = s.file_id
       WHERE s.id = ?`,
    )
    .get(symbolId) as SymbolRow | undefined;
}

/**
 * BFS forward (dependencies): what does this symbol reference?
 * Follows edges where from_id = current. Returns symbols at depth 1..maxDepth.
 */
function bfsForward(db: Database.Database, startId: number, maxDepth: number): SymbolRow[] {
  const stmt = db.prepare(
    `SELECT s.id, s.name, s.kind, s.file_id, s.line_start, s.line_end, s.signature, s.package,
            f.path AS file_path
     FROM edges e JOIN symbols s ON s.id = e.to_id JOIN files f ON f.id = s.file_id
     WHERE e.from_id = ?`,
  );
  return bfs(db, startId, maxDepth, (id) => stmt.all(id) as SymbolRow[]);
}

/**
 * BFS reverse (callers): who references this symbol?
 * Follows edges where to_id = current. Returns symbols at depth 1..maxDepth.
 */
function bfsReverse(db: Database.Database, startId: number, maxDepth: number): SymbolRow[] {
  const stmt = db.prepare(
    `SELECT s.id, s.name, s.kind, s.file_id, s.line_start, s.line_end, s.signature, s.package,
            f.path AS file_path
     FROM edges e JOIN symbols s ON s.id = e.from_id JOIN files f ON f.id = s.file_id
     WHERE e.to_id = ?`,
  );
  return bfs(db, startId, maxDepth, (id) => stmt.all(id) as SymbolRow[]);
}

/**
 * Generic BFS. The `neighbors` callback returns the adjacent symbols for a given id,
 * already filtered to the desired edge direction. The visited set guarantees termination
 * on cycles.
 */
function bfs(
  _db: Database.Database,
  startId: number,
  maxDepth: number,
  neighbors: (id: number) => SymbolRow[],
): SymbolRow[] {
  const visited = new Set<number>([startId]);
  const queue: Array<{ id: number; depth: number }> = [{ id: startId, depth: 0 }];
  const results: SymbolRow[] = [];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    for (const neighbor of neighbors(id)) {
      if (visited.has(neighbor.id)) continue; // cycle: already seen, skip
      visited.add(neighbor.id);
      results.push(neighbor);
      queue.push({ id: neighbor.id, depth: depth + 1 });
    }
  }

  return results;
}

/**
 * Convenience: get ONLY direct (1-hop) neighbors. Used by cs_get_context for the lightweight
 * "what does this symbol touch" view.
 */
export function directNeighbors(
  db: Database.Database,
  symbolId: number,
): { callers: SymbolRow[]; dependencies: SymbolRow[] } {
  return {
    dependencies: bfsForward(db, symbolId, 1),
    callers: bfsReverse(db, symbolId, 1),
  };
}
