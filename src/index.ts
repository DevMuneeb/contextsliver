// Package entry point.
//
// ContextSliver is primarily a CLI + MCP server (run via `npx contextsliver start`), but this
// module re-exports the core building blocks so the engine can be embedded programmatically:
//
//   import { GraphStore, SessionManager, indexRepository } from 'contextsliver';
//
export { GraphStore } from './graph/store.js';
export { blastRadius, directNeighbors } from './graph/traverse.js';
export { SCHEMA_SQL } from './graph/schema.js';
export { SessionManager } from './session/manager.js';
export { indexFile, indexRepository } from './parser/index.js';
export { extractSymbols } from './parser/extractor.js';
export { startMCPServer } from './mcp/server.js';
export { countTokens } from './utils/tokens.js';

export type { SymbolRow, TraversalResult, SymbolKind, EdgeKind } from './graph/types.js';
export type { ParseResult, ExtractedSymbol, ExtractedImport } from './parser/types.js';
export type { ServerOptions } from './mcp/server.js';
export type { ToolContext } from './mcp/types.js';
