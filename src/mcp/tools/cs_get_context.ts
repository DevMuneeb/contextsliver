// cs_get_context — lightweight "what is this symbol + its immediate neighbors" tool.
//
// Cheaper than cs_blast_radius: only 1-hop callers + dependencies, plus the symbol's own
// definition. This is also the canonical place to START a session — the response includes a
// session_id (creating one if not provided) that the agent should pass to subsequent calls.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { directNeighbors } from '../../graph/traverse.js';
import { pruneBySession, symbolsToMark } from '../../session/pruner.js';
import { log } from '../../utils/logger.js';
import { textResponse } from '../responses.js';
import type { ToolContext, ToolModule } from '../types.js';

export const csGetContextTool: ToolModule = {
  register(server: McpServer, ctx: ToolContext): void {
    server.registerTool(
      'cs_get_context',
      {
        description: [
          'Returns a symbol definition plus its immediate (1-hop) callers and dependencies.',
          'Use this to understand a single symbol quickly. Cheaper than cs_blast_radius.',
          'Returns a session_id — pass it to every subsequent cs_* call this session to enable',
          'deduplication (skip context you already have).',
        ].join(' '),
        inputSchema: {
          symbol_name: z
            .string()
            .describe('Exact name of the function/class/variable to look up'),
          session_id: z
            .string()
            .optional()
            .describe('Existing session id. Omit to start a new session.'),
        },
      },
      async (args) => {
        const { symbol_name, session_id } = args;
        log(`cs_get_context symbol="${symbol_name}"`);

        const symbol = ctx.store.findSymbolByName(symbol_name);
        if (!symbol) {
          return textResponse(
            {
              error: `Symbol '${symbol_name}' not found in index.`,
              hint: 'Try cs_search_symbols to locate it, or cs_index_repo to re-index.',
            },
            { annotateTokens: false },
          );
        }

        // Resolve or create the session.
        let sid = session_id;
        if (sid && !ctx.sessionManager.sessionExists(sid)) {
          log(`Unknown session_id; creating new session`, 'warn');
          sid = ctx.sessionManager.createSession(ctx.projectRoot);
        } else if (!sid) {
          sid = ctx.sessionManager.createSession(ctx.projectRoot);
        }

        const neighbors = directNeighbors(ctx.store.raw, symbol.id);
        const pruned = pruneBySession(ctx.sessionManager, sid!, {
          symbol,
          callers: neighbors.callers,
          dependencies: neighbors.dependencies,
        });
        ctx.sessionManager.markAsSent(sid!, symbolsToMark(pruned));

        return textResponse({
          session_id: sid,
          symbol: symbol.name,
          file: symbol.file_path,
          kind: symbol.kind,
          signature: symbol.signature,
          lines: `${symbol.line_start}-${symbol.line_end}`,
          callers: pruned.callers.map((s) => ({
            name: s.name,
            file: s.file_path,
            kind: s.kind,
          })),
          dependencies: pruned.dependencies.map((s) => ({
            name: s.name,
            file: s.file_path,
            kind: s.kind,
          })),
          ...(pruned.skipped.length > 0
            ? { already_in_context: pruned.skipped }
            : {}),
          hint: 'Pass session_id to subsequent cs_* calls to skip already-sent context.',
        });
      },
    );
  },
};
