// MCP server entry point.
//
// Sets up the high-level McpServer (current SDK API: server.registerTool with a Zod raw-shape
// inputSchema), opens the SQLite index, registers all five tools, and connects over stdio.
//
// CRITICAL: stdout is the JSON-RPC protocol channel. Nothing in this server path may write to
// stdout except the SDK transport itself. All our logging goes through utils/logger.ts → stderr.
// The stdout-purity integration test (test/integration/stdout-purity.test.ts) guards this.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { GraphStore } from '../graph/store.js';
import { SessionManager } from '../session/manager.js';
import { ALL_TOOLS } from './tools/index.js';
import { startWatcher } from '../watcher/index.js';
import { log, logError } from '../utils/logger.js';
import type { ToolContext } from './types.js';

export interface ServerOptions {
  /** Absolute project root to index/serve. */
  projectRoot: string;
  /** Start the file watcher alongside the server (default true). */
  watch?: boolean;
}

/**
 * Start the ContextSliver MCP server (stdio transport). Blocks until the client disconnects.
 *
 * - ensures .sliver/ exists and opens index.db
 * - creates the graph store + session manager
 * - registers all tools
 * - optionally starts the file watcher for incremental re-indexing
 */
export async function startMCPServer(opts: ServerOptions): Promise<void> {
  const projectRoot = opts.projectRoot;
  const watch = opts.watch ?? true;

  // 1. Ensure .sliver/ + open the database.
  const sliverDir = join(projectRoot, '.sliver');
  mkdirSync(sliverDir, { recursive: true });
  const dbPath = join(sliverDir, 'index.db');
  const db = new Database(dbPath);
  const store = new GraphStore(db);
  const sessionManager = new SessionManager(db);

  // Opportunistic cleanup of stale sessions.
  try {
    const removed = sessionManager.cleanOldSessions();
    if (removed > 0) log(`Cleaned up ${removed} old session(s)`);
  } catch (err) {
    logError(err);
  }

  // Self-healing: if the index is empty (e.g. server started without prior `init`), index the
  // project now so the tools have something to query. This keeps `start` usable standalone.
  try {
    const stats = store.stats();
    if (stats.files === 0) {
      log('Index is empty; running initial index on startup');
      const { indexRepository } = await import('../parser/index.js');
      const result = indexRepository(store, projectRoot, { force: true });
      log(
        `Startup index: ${result.filesIndexed} files, ${result.symbols} symbols, ${result.edges} edges`,
      );
    }
  } catch (err) {
    // A failed startup index shouldn't kill the server — tools can still trigger cs_index_repo.
    logError(err);
  }

  // 2. Build the tool context (shared by all tool handlers).
  const ctx: ToolContext = { store, sessionManager, projectRoot };

  // 3. Create the server and register tools.
  const server = new McpServer({
    name: 'contextsliver',
    version: '0.1.0',
  });

  for (const tool of ALL_TOOLS) {
    tool.register(server, ctx);
  }
  log(`Registered ${ALL_TOOLS.length} tool(s)`);

  // 4. Optional file watcher for incremental re-indexing.
  if (watch) {
    try {
      startWatcher(store, projectRoot);
    } catch (err) {
      // A dead watcher shouldn't kill the server — log and continue (tools still work).
      logError(err);
      log('File watcher disabled; tools still operational', 'warn');
    }
  }

  // 5. Connect over stdio. This blocks until the client closes the transport.
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('ContextSliver MCP server running on stdio');
}
