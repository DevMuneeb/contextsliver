// Native module health check.
//
// better-sqlite3 and tree-sitter ship as native (NAPI) modules whose binaries must be built
// (or fetched as prebuilds) during `npm install`. Modern npm (v10+) blocks install scripts by
// default ("npm warn allow-scripts"), so a fresh install can land WITHOUT the binaries built —
// in which case the first parse/DB call throws an opaque "Could not locate the bindings file".
//
// This check runs at server startup to surface that case with a clear message and the exact
// fix, rather than letting it fail deep inside better-sqlite3. Uses dynamic import() so a
// failed load is caught rather than crashing the whole module graph.
import { log, logError } from './logger.js';

export interface NativeCheckResult {
  ok: boolean;
  /** human-readable fix instructions if not ok */
  message?: string;
}

/** Instructions shown when native binaries are missing. */
const FIX_INSTRUCTIONS = [
  'One or more native modules failed to load. This usually means their install scripts',
  'were blocked during `npm install` (common with npm v10+). Rebuild them with:',
  '',
  '    npm rebuild better-sqlite3 tree-sitter tree-sitter-typescript tree-sitter-python',
  '',
  'If that fails, approve the install scripts first:',
  '',
  '    npm approve-scripts better-sqlite3 tree-sitter tree-sitter-typescript tree-sitter-python',
  '    npm rebuild better-sqlite3 tree-sitter tree-sitter-typescript tree-sitter-python',
].join('\n');

/**
 * Verify that the native modules actually loaded (their binaries are present).
 * Uses dynamic import so a missing binding is caught, not fatal at import time.
 */
export async function checkNativeModules(): Promise<NativeCheckResult> {
  const problems: string[] = [];

  // better-sqlite3: try to instantiate + query an in-memory DB.
  try {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(':memory:');
    db.prepare('SELECT 1').get();
    db.close();
  } catch (err) {
    problems.push(`better-sqlite3: ${(err as Error).message.split('\n')[0]}`);
  }

  // tree-sitter: try to construct a parser and load a grammar.
  try {
    const Parser = (await import('tree-sitter')).default;
    const TS = (await import('tree-sitter-typescript')).default;
    const p = new Parser();
    // Cast: tree-sitter-typescript's Language type is structurally compatible but the TS
    // definitions diverge slightly. We only care that the binary loaded, not the types here.
    p.setLanguage(TS.typescript as never);
  } catch (err) {
    problems.push(`tree-sitter: ${(err as Error).message.split('\n')[0]}`);
  }

  if (problems.length === 0) return { ok: true };
  return { ok: false, message: `${FIX_INSTRUCTIONS}\n\nDetails: ${problems.join('; ')}` };
}

/**
 * Run the native check; if it fails, log a clear message to stderr. Returns true if healthy.
 * Used by the server/CLI on startup so the user sees the fix instead of a cryptic stack trace.
 */
export async function ensureNativeModulesOrExit(): Promise<boolean> {
  const result = await checkNativeModules();
  if (!result.ok) {
    log('Native module check failed:', 'error');
    logError(new Error(result.message ?? 'Unknown native module failure'));
    log(result.message ?? '', 'error');
    return false;
  }
  log('Native modules OK');
  return true;
}
