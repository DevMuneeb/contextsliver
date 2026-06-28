// Tool registry: the single list of all MCP tools ContextSliver exposes.
//
// To add a tool: create src/mcp/tools/cs_<name>.ts exporting a ToolModule, import it here,
// append to ALL_TOOLS. The server (server.ts) loops over ALL_TOOLS to register each on the
// McpServer.
import type { ToolModule } from '../types.js';
import { csIndexRepoTool } from './cs_index_repo.js';
import { csGetContextTool } from './cs_get_context.js';
import { csBlastRadiusTool } from './cs_blast_radius.js';
import { csSearchSymbolsTool } from './cs_search_symbols.js';
import { csIndexStatusTool } from './cs_index_status.js';

/** Every tool ContextSliver exposes. Order is the order tools appear in tool listings. */
export const ALL_TOOLS: ToolModule[] = [
  csGetContextTool,
  csBlastRadiusTool,
  csSearchSymbolsTool,
  csIndexStatusTool,
  csIndexRepoTool,
];

