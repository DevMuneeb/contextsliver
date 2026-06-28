// Shared MCP response helpers. Keeps tool handlers thin and the response shape consistent
// across all five tools.
import { countTokens } from '../utils/tokens.js';

/** A standard MCP tool response: an array of text content blocks. */
export interface ToolResponse {
  // The MCP SDK's handler return type requires an index signature; content + isError are the
  // fields we always set.
  [x: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/**
 * Build a text response from a JSON-serializable payload, annotated with an approximate
 * token count so the agent can reason about its context budget.
 */
export function textResponse(payload: unknown, opts?: { annotateTokens?: boolean }): ToolResponse {
  const text = JSON.stringify(payload, null, 2);
  const annotate = opts?.annotateTokens ?? true;
  const out = annotate ? `${text}\n\n// ~${countTokens(text)} tokens` : text;
  return { content: [{ type: 'text', text: out }] };
}

/** Build an error response (isError=true) so the client surfaces it as a tool failure. */
export function errorResponse(message: string, hint?: string): ToolResponse {
  const payload: Record<string, unknown> = { error: message };
  if (hint) payload.hint = hint;
  const text = JSON.stringify(payload, null, 2);
  return {
    content: [{ type: 'text', text }],
    isError: true,
  };
}
