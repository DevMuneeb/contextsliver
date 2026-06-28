// Session manager: create sessions + read/write the per-session context ledger.
//
// This is the session-ledger differentiator (contextsliver-spec.md §2): each agent session
// accumulates a record of which symbols it has already received. filterAlreadySent() computes
// the delta — what's new vs. already in context — so a tool never re-sends the same symbol to
// the same session. That's what makes the token bill shrink over the course of a conversation.
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { SymbolRow } from '../graph/types.js';
import type { DeltaResult } from './types.js';

/** Sessions older than this are eligible for cleanup. */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export class SessionManager {
  constructor(private db: Database.Database) {}

  /** Create a new session row. Returns its UUID. */
  createSession(projectRoot: string): string {
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO sessions (id, created_at, project_root) VALUES (?, ?, ?)',
      )
      .run(id, Date.now(), projectRoot);
    return id;
  }

  /** True if the session id exists. */
  sessionExists(sessionId: string): boolean {
    const row = this.db.prepare('SELECT 1 AS one FROM sessions WHERE id = ?').get(sessionId);
    return row !== undefined;
  }

  /**
   * Split a list of symbols into those NOT yet sent this session vs. those already sent.
   * This is the core delta computation.
   */
  filterAlreadySent(
    sessionId: string,
    symbols: SymbolRow[],
  ): DeltaResult<SymbolRow> {
    if (symbols.length === 0) return { fresh: [], alreadySent: [] };

    const sentIds = this.getSentSymbolIds(sessionId);
    const fresh: SymbolRow[] = [];
    const alreadySent: SymbolRow[] = [];

    for (const sym of symbols) {
      if (sentIds.has(sym.id)) {
        alreadySent.push(sym);
      } else {
        fresh.push(sym);
      }
    }
    return { fresh, alreadySent };
  }

  /** Set of symbol ids already sent to a session. */
  private getSentSymbolIds(sessionId: string): Set<number> {
    const rows = this.db
      .prepare('SELECT symbol_id FROM ledger_entries WHERE session_id = ?')
      .all(sessionId) as Array<{ symbol_id: number }>;
    return new Set(rows.map((r) => r.symbol_id));
  }

  /**
   * Record that these symbols were sent to a session. Call after every successful tool
   * response that included symbol context. Idempotent (UNIQUE(session_id, symbol_id)).
   */
  markAsSent(sessionId: string, symbols: SymbolRow[]): void {
    if (symbols.length === 0) return;
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO ledger_entries (session_id, symbol_id, content_hash, sent_at)
       VALUES (?, ?, ?, ?)`,
    );
    const insertMany = this.db.transaction((syms: SymbolRow[]) => {
      const now = Date.now();
      for (const sym of syms) {
        insert.run(sessionId, sym.id, contentHashForSymbol(sym), now);
      }
    });
    insertMany(symbols);
  }

  /** Delete sessions older than SESSION_TTL_MS (and cascade their ledger entries). */
  cleanOldSessions(): number {
    const cutoff = Date.now() - SESSION_TTL_MS;
    const result = this.db.prepare('DELETE FROM sessions WHERE created_at < ?').run(cutoff);
    return result.changes;
  }
}

/**
 * A stable hash representing "what was sent" for a symbol. We use the name + location so that
 * a symbol moved to a new line (but otherwise unchanged) re-sends, while an unchanged symbol
 * at the same location is correctly deduped. (A true content hash would require re-reading the
 * file; this is a good-enough proxy and keeps the ledger cheap.)
 */
function contentHashForSymbol(sym: SymbolRow): string {
  return `${sym.name}:${sym.file_path}:${sym.line_start}`;
}
