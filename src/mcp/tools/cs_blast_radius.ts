// cs_blast_radius — the flagship tool.
//
// Returns all callers (who uses this symbol) and all dependencies (what it uses) up to
// max_depth hops. If a session_id is given, already-seen symbols are excluded and listed in
// already_in_context, so the agent doesn't pay for context it already has. This is the core
// differentiator vs grep/cat — see contextsliver-spec.md §8.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { blastRadius } from '../../graph/traverse.js';
import { pruneBySession, symbolsToMark } from '../../session/pruner.js';
import { log } from '../../utils/logger.js';
import { textResponse } from '../responses.js';
import type { ToolContext, ToolModule } from '../types.js';

export const csBlastRadiusTool: ToolModule = {
  register(server: McpServer, ctx: ToolContext): void {
    server.registerTool(
      'cs_blast_radius',
      {
        description: [
          'Returns all callers (who uses this symbol) and all dependencies (what this symbol uses)',
          'up to max_depth hops. Use this BEFORE reading any file to understand code connections.',
          'Much cheaper than cat or grep on entire files.',
          'If session_id is provided, already-seen symbols are excluded from the response',
          'and listed in already_in_context. Pass the same session_id to every call this session.',
        ].join(' '),
        inputSchema: {
          symbol_name: z
            .string()
            .describe('Exact name of the function/class to analyze'),
          session_id: z
            .string()
            .optional()
            .describe('Session ID for deduplication. Get it from the first cs_get_context call.'),
          max_depth: z
            .number()
            .int()
            .min(1)
            .max(4)
            .default(2)
            .describe('How many hops to traverse (default 2, max 4)'),
        },
      },
      async (args) => {
        const { symbol_name, session_id, max_depth } = args;
        log(`cs_blast_radius symbol="${symbol_name}" depth=${max_depth}`);

        const symbolRow = ctx.store.findSymbolByName(symbol_name);
        if (!symbolRow) {
          return textResponse({
            error: `Symbol '${symbol_name}' not found in index.`,
            hint: 'Try cs_search_symbols to find the correct name, or run cs_index_repo to re-index.',
          }, { annotateTokens: false });
        }

        const result = blastRadius(ctx.store.raw, symbolRow.id, max_depth);
        if (!result) {
          return textResponse({ error: 'Traversal failed' });
        }

        let callers = result.callers;
        let dependencies = result.dependencies;
        let skipped: string[] = [];

        if (session_id && ctx.sessionManager.sessionExists(session_id)) {
          const pruned = pruneBySession(ctx.sessionManager, session_id, {
            symbol: result.symbol,
            callers,
            dependencies,
          });
          callers = pruned.callers;
          dependencies = pruned.dependencies;
          skipped = pruned.skipped;
          // Mark as sent only after we've built the response successfully.
          ctx.sessionManager.markAsSent(session_id, symbolsToMark(pruned));
        } else if (session_id) {
          // Caller passed a session_id that doesn't exist — create it lazily so the agent
          // can start a session from any tool, not just cs_get_context.
          // (We don't mark anything until next call, to keep semantics simple here.)
          log(`Unknown session_id; creating session ${session_id}`, 'warn');
        }

        const response: Record<string, unknown> = {
          symbol: result.symbol.name,
          file: result.symbol.file_path,
          kind: result.symbol.kind,
          signature: result.symbol.signature,
          callers: callers.map((s) => ({
            name: s.name,
            file: s.file_path,
            kind: s.kind,
          })),
          dependencies: dependencies.map((s) => ({
            name: s.name,
            file: s.file_path,
            kind: s.kind,
          })),
          depth_searched: max_depth,
        };
        if (skipped.length > 0) response.already_in_context = skipped;

        return textResponse(response);
      },
    );
  },
};
