// cs_index_status — report index health: file/symbol/edge counts, last-indexed time, freshness.
//
// Cheap to call; the agent can use it to sanity-check before relying on cs_get_context /
// cs_blast_radius results.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { log } from '../../utils/logger.js';
import { textResponse } from '../responses.js';
import type { ToolContext, ToolModule } from '../types.js';

export const csIndexStatusTool: ToolModule = {
  register(server: McpServer, ctx: ToolContext): void {
    server.registerTool(
      'cs_index_status',
      {
        description: [
          'Report the health of the index: number of files, symbols, edges, and when the index was',
          'last updated. Use this to check whether the index is fresh before relying on',
          'cs_get_context / cs_blast_radius results.',
        ].join(' '),
        inputSchema: {},
      },
      async () => {
        log('cs_index_status');
        const stats = ctx.store.stats();
        const lastIndexed = stats.lastIndexedAt
          ? new Date(stats.lastIndexedAt).toISOString()
          : null;
        return textResponse({
          status: stats.files > 0 ? 'ok' : 'empty',
          files: stats.files,
          symbols: stats.symbols,
          edges: stats.edges,
          last_indexed: lastIndexed,
          hint:
            stats.files === 0
              ? 'Index is empty. Run cs_index_repo to populate it.'
              : undefined,
        });
      },
    );
  },
};
