// Token counting. Used to label tool responses with an approximate token cost so the agent
// can reason about budget. Counts are deliberately labeled "~approximate".
//
// Uses gpt-tokenizer (cl100k_base) — pure JS, synchronous, no WASM/native. If it ever throws
// (e.g. unexpected input), we fall back to a rough chars/4 estimate rather than failing the call.
import { encode } from 'gpt-tokenizer';

const FALLBACK_CHARS_PER_TOKEN = 4;

/**
 * Count tokens in a string using cl100k_base, with a chars/4 fallback on any error.
 * Returns a non-negative integer. Never throws.
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  try {
    return encode(text).length;
  } catch {
    return Math.ceil(text.length / FALLBACK_CHARS_PER_TOKEN);
  }
}

/**
 * Sum tokens across multiple strings (e.g. a response with several content parts).
 */
export function countTokensMany(texts: string[]): number {
  return texts.reduce((sum, t) => sum + countTokens(t), 0);
}
