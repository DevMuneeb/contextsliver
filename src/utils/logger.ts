// CRITICAL: All logging MUST go to stderr.
// stdout is the MCP protocol channel (JSON-RPC). Any console.log() there corrupts the
// protocol stream and silently disconnects the client — the agent stops working with no error.
// The `no-console` eslint rule (allowing only console.error) enforces this in src/.
// Tests: test/integration/stdout-purity.test.ts asserts stdout stays clean.

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const LEVEL_PREFIX: Record<LogLevel, string> = {
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
  debug: 'DEBUG',
};

// SLIVER_DEBUG=1 enables debug logs. Off by default to keep stderr quiet for clients.
const DEBUG_ON = process.env.SLIVER_DEBUG === '1' || process.env.SLIVER_DEBUG === 'true';

/**
 * Write a log line to stderr. Never touches stdout.
 *
 * @param message - human-readable message
 * @param level - severity; 'debug' is suppressed unless SLIVER_DEBUG=1
 */
export function log(message: string, level: LogLevel = 'info'): void {
  if (level === 'debug' && !DEBUG_ON) return;
  process.stderr.write(`[contextsliver:${LEVEL_PREFIX[level]}] ${message}\n`);
}

/**
 * Log an error with its stack trace (if available). Used in catch blocks.
 */
export function logError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  log(message, 'error');
  if (err instanceof Error && err.stack) {
    // stack already includes the message; write it raw for debugging
    process.stderr.write(`[contextsliver:ERROR] ${err.stack}\n`);
  }
}
