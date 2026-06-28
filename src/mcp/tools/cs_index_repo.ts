// cs_index_repo — trigger a full re-index of the project.
//
// Rarely needed in normal use (the file watcher keeps the index fresh after `start`), but
// useful if the index gets out of sync (e.g. files changed while the server was down, or after
// a git branch switch). Returns a status summary, not the symbols themselves.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { indexRepository } from '../../parser/index.js';
import { log } from '../../utils/logger.js';
import { textResponse } from '../responses.js';
import type { ToolContext, ToolModule } from '../types.js';

export const csIndexRepoTool: ToolModule = {
  register(server: McpServer, ctx: ToolContext): void {
    server.registerTool(
      'cs_index_repo',
      {
        description: [
          'Trigger a full re-index of the project into the SQLite graph. Normally the file watcher',
          'keeps the index fresh automatically; use this only if the index is out of sync',
          '(e.g. after a git branch switch with the server stopped). Returns a status summary.',
        ].join(' '),
        inputSchema: {
          force: z
            .boolean()
            .default(false)
            .describe('If true, re-parse every file even if its hash is unchanged.'),
        },
      },
      async (args) => {
        const { force } = args;
        log(`cs_index_repo force=${force}`);
        try {
          const result = indexRepository(ctx.store, ctx.projectRoot, { force });
          return textResponse({
            status: 'ok',
            files_indexed: result.filesIndexed,
            files_skipped: result.filesSkipped,
            symbols: result.symbols,
            edges: result.edges,
            duration_ms: result.durationMs,
          });
        } catch (err) {
          log(`cs_index_repo failed: ${(err as Error).message}`, 'error');
          return textResponse(
            { status: 'error', message: (err as Error).message },
            { annotateTokens: false },
          );
        }
      },
    );
  },
};
