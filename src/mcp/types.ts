// Shared MCP types.
//
// ToolContext is what every tool handler receives — the dependencies it needs to do its job,
// injected by the server. This keeps tools testable (pass a mock context) and decoupled from
// how the server is wired.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GraphStore } from '../graph/store.js';
import type { SessionManager } from '../session/manager.js';

/** Dependencies passed to every tool handler. */
export interface ToolContext {
  /** the graph store (read + write for re-index tools) */
  store: GraphStore;
  /** session ledger manager (for dedup) */
  sessionManager: SessionManager;
  /** absolute project root */
  projectRoot: string;
}

/**
 * A tool module: registers itself on the server using the current high-level MCP SDK API
 * (server.registerTool with a Zod raw-shape inputSchema). Each tool lives in its own file
 * and exports a `register(server, ctx)` function; tools/index.ts collects them.
 */
export type ToolModule = {
  /** Register the tool on the given McpServer, closing over ctx. */
  register: (server: McpServer, ctx: ToolContext) => void;
};
