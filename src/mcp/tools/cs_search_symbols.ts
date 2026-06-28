// cs_search_symbols — full-text-ish search across all indexed symbols.
//
// Use this when you don't know the exact name or location of a symbol. Substring-matches on
// symbol name + file path, prioritizing exact-ish name hits. Much cheaper than find/grep on
// the whole repo, since it only searches the symbol index.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { log } from '../../utils/logger.js';
import { textResponse } from '../responses.js';
import type { ToolContext, ToolModule } from '../types.js';

export const csSearchSymbolsTool: ToolModule = {
  register(server: McpServer, ctx: ToolContext): void {
    server.registerTool(
      'cs_search_symbols',
      {
        description: [
          'Search across all indexed symbols (functions, classes, interfaces, types) by name',
          'or file path. Use this instead of find/grep to locate a symbol. Returns matches with',
          'their file + kind + line range.',
        ].join(' '),
        inputSchema: {
          query: z
            .string()
            .min(1)
            .describe('Substring to search for in symbol names or file paths'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .default(20)
            .describe('Max results to return (default 20)'),
        },
      },
      async (args) => {
        const { query, limit } = args;
        log(`cs_search_symbols query="${query}" limit=${limit}`);

        const matches = ctx.store.searchSymbols(query, limit);
        if (matches.length === 0) {
          return textResponse(
            { query, results: [], hint: 'No matches. Try cs_index_repo if the index is stale.' },
            { annotateTokens: false },
          );
        }
        return textResponse({
          query,
          count: matches.length,
          results: matches.map((m) => ({
            name: m.name,
            kind: m.kind,
            file: m.file_path,
            lines: `${m.line_start}-${m.line_end}`,
            signature: m.signature,
          })),
        });
      },
    );
  },
};
