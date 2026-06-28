// Session ledger types. A "session" = one agent conversation. The ledger records which
// symbols' context was already sent to that agent, so subsequent tool calls can skip them.

export interface Session {
  id: string; // UUID
  created_at: number; // unix ms
  project_root: string;
}

/** A row in `ledger_entries` — proof that a symbol was sent to a session. */
export interface LedgerEntry {
  id: number;
  session_id: string;
  symbol_id: number;
  content_hash: string;
  sent_at: number;
}

/** Outcome of delta computation: which symbols are new vs. already sent. */
export interface DeltaResult<T> {
  /** symbols NOT yet sent this session — these go into the response */
  fresh: T[];
  /** symbols already sent — skipped to save tokens */
  alreadySent: T[];
}
