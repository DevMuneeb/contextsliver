# ContextSliver — Complete Project Specification
> **This document is the single source of truth for building ContextSliver.**
> An AI agent can execute this top-to-bottom with no additional clarification needed.
> Every decision is made. Every file is specified. Every test is described.

---

## 1. THE PROBLEM (Plain English)

### What happens today when you use Claude Code, Cursor, or any AI coding agent

You ask: *"Fix the bug in AuthService"*

The agent does this:
```
1. Runs: find . -type f -name "*.ts"        → lists 200 files → ~2,000 tokens
2. Runs: cat src/auth/AuthService.ts         → reads whole file → ~3,000 tokens
3. Runs: grep -r "AuthService" src/          → finds 40 matches → ~5,000 tokens
4. Runs: cat src/auth/AuthMiddleware.ts      → reads whole file → ~2,500 tokens
5. Runs: cat src/users/UserService.ts        → reads whole file → ~3,000 tokens
... repeats 10–15 more times ...
```

**Total: 40,000–80,000 tokens to answer a question that needed ~3,000 tokens of actual context.**

The agent reads entire files to find the 5% that's relevant. It re-reads files it already saw 3 messages ago. It dumps directory trees nobody asked for. This is where your API bill comes from.

### Why existing tools don't fix it

**Graphify** builds a static map of your whole codebase and dumps the entire map into Claude's context at session start. On a 200-file repo, that map can be 30,000–50,000 tokens — you've just replaced "reading 20 files" with "reading one enormous JSON blob." Same cost, different shape. It also never updates during the session, so it re-sends everything from scratch every time.

**Repomix** packs your entire repo into one file and feeds it to the AI. Useful for small projects, catastrophically expensive for anything over 100 files.

**Aider's repo-map** is the best existing approach — it uses Tree-sitter + PageRank to rank which files matter most and fits them into a token budget. But it still sends a *whole-repo summary* with every message, and it has no awareness of what Claude already knows from earlier in the session.

**None of them track what the AI has already seen this session.**

### What ContextSliver does instead

ContextSliver runs as a background service on your machine. It indexes your codebase into a local SQLite database — a graph of every function, class, and import relationship.

When Claude needs context, instead of reading files, it asks ContextSliver:

```
Claude: "What connects to AuthService? Budget: 2,000 tokens."

ContextSliver: {
  "symbol": "AuthService",
  "file": "src/auth/AuthService.ts",
  "callers": ["AuthMiddleware", "LoginController"],      ← who uses it
  "dependencies": ["UserRepository", "TokenService"],    ← what it uses
  "already_sent_this_session": ["UserRepository"],       ← skip these, Claude already has them
  "tokens_used": 380
}
```

Claude gets exactly what it needs. Nothing it doesn't. And nothing it already has.

### The three things that make ContextSliver different

1. **On-demand pruning** — never sends the whole graph, only the connected subgraph relevant to the current task
2. **Session ledger** — tracks what Claude has already seen this session and skips re-sending it
3. **One command setup** — `npx contextsliver init` and it works. No database server, no API key, no manual config

---

## 2. THE SOLUTION ARCHITECTURE

### High-level flow

```
Developer's machine
│
├── Your codebase (src/, lib/, etc.)
│   └── [chokidar watches for file changes]
│
├── .sliver/
│   ├── index.db          ← SQLite: all symbols + edges + hashes
│   └── sessions.db       ← SQLite: per-session ledger of sent context
│
└── ContextSliver daemon (npx contextsliver start)
    │
    ├── Parser (Tree-sitter)
    │   └── extracts symbols + imports from every file
    │
    ├── Graph engine
    │   └── stores symbol→symbol edges, queries blast radius
    │
    ├── Session manager
    │   └── tracks what was sent per session, computes deltas
    │
    └── MCP server (stdio)
        └── Claude Code / Cursor / Cline connect here
            and call tools instead of reading files
```

### The five MCP tools Claude gets

| Tool | What it does | Tokens returned (typical) |
|------|-------------|--------------------------|
| `cs_index_repo` | Triggers a full re-index of the project | ~50 (status only) |
| `cs_get_context` | Returns symbol definition + immediate connections | ~300–800 |
| `cs_blast_radius` | Returns all callers + dependents up to N hops | ~500–2,000 |
| `cs_search_symbols` | Full-text search across all indexed symbols | ~200–600 |
| `cs_index_status` | Returns index health, file count, last-updated | ~100 |

### Why SQLite and not something fancier

- Zero setup — it's a file, not a server
- Supports recursive CTEs for graph traversal natively
- Fast enough for 50,000-file repos when indexed properly
- Every developer already has it or gets it silently via better-sqlite3
- DuckDB added as optional backend for very large monorepos (post v0.5)

---

## 3. COMPLETE REPOSITORY STRUCTURE

```
contextsliver/
│
├── README.md                          ← project overview + quickstart
├── CONTRIBUTING.md                    ← language plugin guide
├── LICENSE                            ← MIT
├── package.json                       ← npm package config
├── tsconfig.json                      ← TypeScript config
├── tsconfig.build.json                ← build-only tsconfig
├── .eslintrc.json
├── .prettierrc
├── vitest.config.ts                   ← test runner config
├── .github/
│   └── workflows/
│       ├── ci.yml                     ← lint + test + build on PR
│       └── publish.yml                ← npm publish on tag
│
├── src/
│   ├── index.ts                       ← package entry point
│   ├── cli.ts                         ← CLI entry point (bin/contextsliver)
│   │
│   ├── mcp/
│   │   ├── server.ts                  ← MCP server setup + transport
│   │   ├── tools/
│   │   │   ├── index.ts               ← tool registry
│   │   │   ├── cs_index_repo.ts
│   │   │   ├── cs_get_context.ts
│   │   │   ├── cs_blast_radius.ts
│   │   │   ├── cs_search_symbols.ts
│   │   │   └── cs_index_status.ts
│   │   └── types.ts                   ← shared MCP types
│   │
│   ├── parser/
│   │   ├── index.ts                   ← parser entry point
│   │   ├── extractor.ts               ← extracts symbols from a file
│   │   ├── languages/
│   │   │   ├── registry.ts            ← language plugin registry
│   │   │   ├── typescript.ts          ← TS/JS plugin
│   │   │   ├── python.ts              ← Python plugin
│   │   │   └── go.ts                  ← Go plugin (v0.4)
│   │   └── types.ts                   ← Symbol, Edge, ParseResult types
│   │
│   ├── graph/
│   │   ├── store.ts                   ← SQLite operations (read/write symbols+edges)
│   │   ├── schema.ts                  ← CREATE TABLE statements
│   │   ├── traverse.ts                ← blast_radius BFS with cycle detection
│   │   ├── rank.ts                    ← PageRank-style importance scoring
│   │   └── types.ts                   ← GraphNode, GraphEdge types
│   │
│   ├── watcher/
│   │   ├── index.ts                   ← chokidar setup + debounce
│   │   └── hasher.ts                  ← content hash + dirty-flag logic
│   │
│   ├── session/
│   │   ├── manager.ts                 ← session creation, ledger read/write
│   │   ├── pruner.ts                  ← delta computation (what's new vs already sent)
│   │   └── types.ts                   ← Session, LedgerEntry types
│   │
│   ├── monorepo/
│   │   ├── detector.ts                ← detect workspace type (npm, pnpm, yarn, nx, turbo)
│   │   ├── resolver.ts                ← resolve cross-package imports
│   │   └── types.ts
│   │
│   └── utils/
│       ├── logger.ts                  ← stderr-only logger (NEVER stdout)
│       ├── paths.ts                   ← path normalization utilities
│       └── tokens.ts                  ← token counting (tiktoken-lite)
│
├── grammars/
│   ├── typescript/
│   │   └── tags.scm                   ← Tree-sitter query: extract symbols
│   ├── python/
│   │   └── tags.scm
│   └── go/
│       └── tags.scm
│
├── fixtures/                          ← test fixtures per language
│   ├── typescript/
│   │   ├── simple.ts                  ← basic class + function
│   │   ├── circular.ts                ← circular imports (tests cycle detection)
│   │   └── expected/
│   │       ├── simple.json            ← expected extracted symbols
│   │       └── circular.json
│   ├── python/
│   │   ├── simple.py
│   │   └── expected/simple.json
│   └── monorepo/
│       ├── packages/
│       │   ├── ui/src/Button.ts
│       │   └── app/src/App.ts         ← imports from @myorg/ui
│       └── expected/cross-package.json
│
├── test/
│   ├── unit/
│   │   ├── parser.test.ts             ← golden-file tests per language
│   │   ├── graph.test.ts              ← store + traverse + cycle detection
│   │   ├── session.test.ts            ← ledger + pruner
│   │   └── hasher.test.ts             ← dirty-flag logic
│   ├── integration/
│   │   ├── mcp-protocol.test.ts       ← MCP tool schemas + responses
│   │   └── stdout-purity.test.ts      ← assert nothing leaks to stdout
│   ├── e2e/
│   │   └── token-reduction.test.ts    ← measure tokens with/without tool
│   └── bench/
│       └── indexing.bench.ts          ← 500/5k file indexing benchmarks
│
├── hooks/
│   └── pre-tool-use.js                ← optional Claude Code hook
│
└── templates/
    ├── CLAUDE.md                      ← shipped CLAUDE.md template
    ├── mcp-config-claude-code.json    ← copy-paste MCP config
    ├── mcp-config-cursor.json
    └── mcp-config-cline.json
```

---

## 4. TECH STACK — EVERY DECISION WITH REASON

| Concern | Choice | Why | Alternative rejected |
|---------|--------|-----|---------------------|
| Language | TypeScript | MCP SDK is TS-first; largest contributor pool; type safety for graph operations | Python (slower under load), Rust (harder to contribute to v0.1) |
| Runtime | Node.js 20 LTS | LTS stability; chokidar v4 requires Node 18+; broad compatibility | Bun (not yet LTS), Deno (different module system) |
| MCP SDK | `@modelcontextprotocol/sdk` | Official Anthropic SDK; most complete; best docs | Rolling own JSON-RPC (too much work) |
| MCP transport | stdio | Best for local single-client use; zero network config | HTTP (adds complexity, needed later) |
| AST parser | `tree-sitter` + `tree-sitter-language-pack` | Fast, incremental, 100+ languages, pre-built binaries, used by aider | Babel (JS-only), python-ast (Python-only), ctags (legacy) |
| Graph storage | `better-sqlite3` | Zero setup, recursive CTEs, synchronous API (right for this use case), 50k files fine | DuckDB (v0.6+ optional), Neo4j (requires server), in-memory (lost on restart) |
| File watching | `chokidar` v4 | De-facto standard, cross-platform, normalizes raw fs events | watchman (external daemon), raw fs.watch (unreliable) |
| Token counting | `js-tiktoken` | Lightweight, accurate for Claude/GPT tokenizers, runs in Node | tiktoken native (heavier) |
| Test runner | `vitest` | Fast, native TypeScript, watch mode, compatible with Node | Jest (slower TS setup), mocha (older API) |
| Linter | `eslint` + `@typescript-eslint` | Standard; catches common TS mistakes | biome (newer, less plugin support) |
| Formatter | `prettier` | Standard; eliminates style debates | biome |
| Build | `tsc` (no bundler) | MCP servers don't need bundling; simpler | esbuild, rollup |
| Package manager | `npm` | Universal, no extra tooling required | pnpm (adds .npmrc complexity), yarn |
| CI | GitHub Actions | Free for OSS; matrix across Node versions + OS | CircleCI, Jenkins |

---

## 5. COMPLETE package.json

```json
{
  "name": "contextsliver",
  "version": "0.1.0",
  "description": "Universal context-management MCP server for AI coding agents. On-demand dependency graph pruning with session awareness.",
  "keywords": ["mcp", "claude", "cursor", "ai", "coding", "context", "token-reduction", "tree-sitter"],
  "homepage": "https://github.com/YOUR_ORG/contextsliver",
  "bugs": "https://github.com/YOUR_ORG/contextsliver/issues",
  "repository": {
    "type": "git",
    "url": "https://github.com/YOUR_ORG/contextsliver.git"
  },
  "license": "MIT",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "contextsliver": "dist/cli.js"
  },
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist/", "grammars/", "templates/", "hooks/"],
  "engines": { "node": ">=20.0.0" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "dev": "tsc --watch",
    "start": "node dist/cli.js start",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:bench": "vitest bench",
    "lint": "eslint src/ test/",
    "format": "prettier --write src/ test/",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "npm run build && npm test"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "better-sqlite3": "^9.0.0",
    "chokidar": "^4.0.0",
    "commander": "^12.0.0",
    "js-tiktoken": "^1.0.0",
    "tree-sitter": "^0.21.0",
    "tree-sitter-language-pack": "^0.3.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^20.0.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "eslint": "^8.0.0",
    "prettier": "^3.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.0.0"
  }
}
```

---

## 6. DATABASE SCHEMA (src/graph/schema.ts)

```typescript
// Every CREATE TABLE statement for the SQLite index
// Run once on init, idempotent (IF NOT EXISTS)

export const SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  -- One row per indexed file
  CREATE TABLE IF NOT EXISTS files (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    path        TEXT    NOT NULL UNIQUE,   -- relative to project root
    content_hash TEXT   NOT NULL,          -- SHA-256 of file content
    indexed_at  INTEGER NOT NULL,          -- unix timestamp
    language    TEXT    NOT NULL           -- 'typescript' | 'python' | 'go'
  );

  -- One row per extracted symbol (function, class, interface, variable)
  CREATE TABLE IF NOT EXISTS symbols (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,          -- e.g. 'AuthService'
    kind        TEXT    NOT NULL,          -- 'function' | 'class' | 'interface' | 'variable' | 'type'
    line_start  INTEGER NOT NULL,
    line_end    INTEGER NOT NULL,
    signature   TEXT,                      -- condensed definition, not full body
    package     TEXT                       -- monorepo: owning package name
  );

  CREATE INDEX IF NOT EXISTS idx_symbols_name     ON symbols(name);
  CREATE INDEX IF NOT EXISTS idx_symbols_file_id  ON symbols(file_id);
  CREATE INDEX IF NOT EXISTS idx_symbols_package  ON symbols(package);

  -- Directed edges: symbol A references symbol B
  CREATE TABLE IF NOT EXISTS edges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id     INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    to_id       INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    kind        TEXT    NOT NULL,          -- 'calls' | 'imports' | 'extends' | 'implements' | 'uses'
    UNIQUE(from_id, to_id, kind)
  );

  CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
  CREATE INDEX IF NOT EXISTS idx_edges_to   ON edges(to_id);

  -- Session ledger: what was already sent in each agent session
  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT    PRIMARY KEY,       -- UUID
    created_at  INTEGER NOT NULL,
    project_root TEXT   NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ledger_entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    symbol_id   INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    content_hash TEXT   NOT NULL,          -- hash at time of sending
    sent_at     INTEGER NOT NULL,
    UNIQUE(session_id, symbol_id)
  );

  CREATE INDEX IF NOT EXISTS idx_ledger_session ON ledger_entries(session_id);
`;
```

---

## 7. CORE IMPLEMENTATION FILES

### 7.1 Graph traversal with cycle detection (src/graph/traverse.ts)

```typescript
import type Database from 'better-sqlite3';

export interface TraversalResult {
  symbol: SymbolRow;
  callers: SymbolRow[];       // who calls/uses this symbol (reverse edges)
  dependencies: SymbolRow[];  // what this symbol calls/uses (forward edges)
  depth: number;
}

export interface SymbolRow {
  id: number;
  name: string;
  kind: string;
  file_path: string;
  line_start: number;
  line_end: number;
  signature: string | null;
  package: string | null;
}

// Bidirectional BFS from a focal symbol up to maxDepth hops.
// Cycle detection via visited set — NEVER uses recursion to avoid stack overflow
// on circular dependency graphs.
export function blastRadius(
  db: Database.Database,
  symbolId: number,
  maxDepth: number = 2
): TraversalResult | null {
  // Get the focal symbol
  const focal = db.prepare(`
    SELECT s.id, s.name, s.kind, s.line_start, s.line_end, s.signature, s.package,
           f.path as file_path
    FROM symbols s
    JOIN files f ON f.id = s.file_id
    WHERE s.id = ?
  `).get(symbolId) as SymbolRow | undefined;

  if (!focal) return null;

  // BFS forward (dependencies): what does this symbol use?
  const dependencies = bfsForward(db, symbolId, maxDepth);

  // BFS reverse (callers): who uses this symbol?
  const callers = bfsReverse(db, symbolId, maxDepth);

  return { symbol: focal, callers, dependencies, depth: maxDepth };
}

function bfsForward(
  db: Database.Database,
  startId: number,
  maxDepth: number
): SymbolRow[] {
  const visited = new Set<number>([startId]);
  const queue: Array<{ id: number; depth: number }> = [{ id: startId, depth: 0 }];
  const results: SymbolRow[] = [];

  const stmt = db.prepare(`
    SELECT s.id, s.name, s.kind, s.line_start, s.line_end, s.signature, s.package,
           f.path as file_path
    FROM edges e
    JOIN symbols s ON s.id = e.to_id
    JOIN files f ON f.id = s.file_id
    WHERE e.from_id = ?
  `);

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const neighbors = stmt.all(id) as SymbolRow[];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor.id)) {
        visited.add(neighbor.id);
        results.push(neighbor);
        queue.push({ id: neighbor.id, depth: depth + 1 });
      }
      // If already visited: skip (cycle handled)
    }
  }

  return results;
}

function bfsReverse(
  db: Database.Database,
  startId: number,
  maxDepth: number
): SymbolRow[] {
  const visited = new Set<number>([startId]);
  const queue: Array<{ id: number; depth: number }> = [{ id: startId, depth: 0 }];
  const results: SymbolRow[] = [];

  const stmt = db.prepare(`
    SELECT s.id, s.name, s.kind, s.line_start, s.line_end, s.signature, s.package,
           f.path as file_path
    FROM edges e
    JOIN symbols s ON s.id = e.from_id
    JOIN files f ON f.id = s.file_id
    WHERE e.to_id = ?
  `);

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const neighbors = stmt.all(id) as SymbolRow[];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor.id)) {
        visited.add(neighbor.id);
        results.push(neighbor);
        queue.push({ id: neighbor.id, depth: depth + 1 });
      }
    }
  }

  return results;
}
```

### 7.2 Session ledger and delta computation (src/session/manager.ts)

```typescript
import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { SymbolRow } from '../graph/traverse.js';

export class SessionManager {
  constructor(private db: Database.Database) {}

  createSession(projectRoot: string): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO sessions (id, created_at, project_root)
      VALUES (?, ?, ?)
    `).run(id, Date.now(), projectRoot);
    return id;
  }

  // Returns only symbols NOT already sent this session.
  // This is the core delta computation — the session ledger differentiator.
  filterAlreadySent(
    sessionId: string,
    symbols: SymbolRow[]
  ): { fresh: SymbolRow[]; alreadySent: SymbolRow[] } {
    if (symbols.length === 0) return { fresh: [], alreadySent: [] };

    const sentIds = new Set<number>(
      (this.db.prepare(`
        SELECT symbol_id FROM ledger_entries WHERE session_id = ?
      `).all(sessionId) as Array<{ symbol_id: number }>)
        .map((r) => r.symbol_id)
    );

    const fresh: SymbolRow[] = [];
    const alreadySent: SymbolRow[] = [];

    for (const sym of symbols) {
      if (sentIds.has(sym.id)) {
        alreadySent.push(sym);
      } else {
        fresh.push(sym);
      }
    }

    return { fresh, alreadySent };
  }

  // Mark symbols as sent. Call after every successful tool response.
  markAsSent(sessionId: string, symbols: SymbolRow[]): void {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO ledger_entries
        (session_id, symbol_id, content_hash, sent_at)
      VALUES (?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((syms: SymbolRow[]) => {
      for (const sym of syms) {
        insert.run(sessionId, sym.id, `${sym.name}-${sym.line_start}`, Date.now());
      }
    });

    insertMany(symbols);
  }

  // Delete sessions older than 24 hours (cleanup)
  cleanOldSessions(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    this.db.prepare(`DELETE FROM sessions WHERE created_at < ?`).run(cutoff);
  }
}
```

### 7.3 MCP server entry point (src/mcp/server.ts)

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../graph/schema.js';
import { SessionManager } from '../session/manager.js';
import { toolRegistry } from './tools/index.js';
import { log } from '../utils/logger.js';   // logs to STDERR only — never stdout
import path from 'path';
import fs from 'fs';

export async function startMCPServer(projectRoot: string): Promise<void> {
  // Ensure .sliver directory exists
  const sliverDir = path.join(projectRoot, '.sliver');
  fs.mkdirSync(sliverDir, { recursive: true });

  // Open SQLite database (single file, no server needed)
  const db = new Database(path.join(sliverDir, 'index.db'));
  db.exec(SCHEMA_SQL);

  const sessionManager = new SessionManager(db);

  // Create MCP server
  const server = new Server(
    { name: 'contextsliver', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  // Register tool list
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolRegistry.map((t) => t.definition),
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = toolRegistry.find((t) => t.definition.name === request.params.name);
    if (!tool) throw new Error(`Tool not found: ${request.params.name}`);

    log(`Tool called: ${request.params.name}`);  // stderr only

    return tool.handler({
      args: request.params.arguments ?? {},
      db,
      sessionManager,
      projectRoot,
    });
  });

  // Connect via stdio — stdout is the protocol channel, never log to it
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log('ContextSliver MCP server running');
}
```

### 7.4 Logger — stderr only, never stdout (src/utils/logger.ts)

```typescript
// CRITICAL: All logging MUST go to stderr.
// stdout is the MCP protocol channel. Any console.log() here
// corrupts JSON-RPC and silently disconnects the client.

export function log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  process.stderr.write(`[contextsliver:${level}] ${message}\n`);
}

export function logError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  log(message, 'error');
  if (err instanceof Error && err.stack) {
    log(err.stack, 'error');
  }
}
```

### 7.5 File watcher with incremental indexing (src/watcher/index.ts)

```typescript
import chokidar from 'chokidar';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import type Database from 'better-sqlite3';
import { log } from '../utils/logger.js';
import { indexFile } from '../parser/index.js';

const DEBOUNCE_MS = 300;  // wait 300ms after last change before re-indexing

const IGNORED_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.sliver/**',
  '**/dist/**',
  '**/build/**',
  '**/*.min.js',
  '**/__pycache__/**',
];

export function startWatcher(db: Database.Database, projectRoot: string): void {
  const timers = new Map<string, NodeJS.Timeout>();

  const watcher = chokidar.watch(projectRoot, {
    ignored: IGNORED_PATTERNS,
    persistent: true,
    ignoreInitial: true,   // don't fire for files already indexed on startup
  });

  const handleChange = (filePath: string) => {
    // Debounce: reset timer on rapid successive changes
    if (timers.has(filePath)) clearTimeout(timers.get(filePath)!);

    timers.set(filePath, setTimeout(() => {
      timers.delete(filePath);
      maybeReindex(db, filePath);
    }, DEBOUNCE_MS));
  };

  watcher
    .on('change', handleChange)
    .on('add', handleChange)
    .on('unlink', (filePath) => {
      // Remove file and all its symbols from the index
      db.prepare(`DELETE FROM files WHERE path = ?`).run(
        filePath.replace(projectRoot + '/', '')
      );
      log(`Removed from index: ${filePath}`);
    })
    .on('error', (err) => log(`Watcher error: ${err}`, 'error'));

  log('File watcher started');
}

function maybeReindex(db: Database.Database, filePath: string): void {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const newHash = createHash('sha256').update(content).digest('hex');

    // Skip if content hasn't actually changed (handles editor save-without-edit)
    const existing = db.prepare(`SELECT content_hash FROM files WHERE path = ?`)
      .get(filePath) as { content_hash: string } | undefined;

    if (existing?.content_hash === newHash) {
      log(`Skip (unchanged): ${filePath}`);
      return;
    }

    // Re-index only this one file
    indexFile(db, filePath, content, newHash);
    log(`Re-indexed: ${filePath}`);
  } catch (err) {
    log(`Error re-indexing ${filePath}: ${err}`, 'error');
  }
}
```

### 7.6 CLI entry point (src/cli.ts)

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import { startMCPServer } from './mcp/server.js';
import { indexRepository } from './parser/index.js';
import { log } from './utils/logger.js';

const program = new Command();

program
  .name('contextsliver')
  .description('Universal context-management MCP server for AI coding agents')
  .version('0.1.0');

// npx contextsliver init
// Run once to set up a project
program
  .command('init')
  .description('Initialize ContextSliver for the current project')
  .option('--root <path>', 'Project root directory', process.cwd())
  .action(async (opts) => {
    const root = path.resolve(opts.root);
    log(`Initializing ContextSliver in ${root}`);

    // 1. Create .sliver directory
    fs.mkdirSync(path.join(root, '.sliver'), { recursive: true });

    // 2. Add .sliver to .gitignore
    addToGitignore(root);

    // 3. Write MCP config
    writeMcpConfig(root);

    // 4. Write CLAUDE.md template (if not exists)
    writeClaudeMd(root);

    // 5. Run initial index
    console.error('Indexing project (this may take 10–60 seconds for large repos)...');
    await indexRepository(root);
    console.error('✓ Index complete');

    console.error('\n✓ ContextSliver initialized.');
    console.error('  Next: restart Claude Code or Cursor to pick up the new MCP server.');
    console.error('  Then start the watcher: npx contextsliver start');
  });

// npx contextsliver start
// Run the MCP server (with file watcher)
program
  .command('start')
  .description('Start the ContextSliver MCP server and file watcher')
  .option('--root <path>', 'Project root directory', process.cwd())
  .action(async (opts) => {
    const root = path.resolve(opts.root);
    await startMCPServer(root);
  });

// npx contextsliver reindex
// Force full re-index
program
  .command('reindex')
  .description('Force a full re-index of the project')
  .option('--root <path>', 'Project root directory', process.cwd())
  .action(async (opts) => {
    const root = path.resolve(opts.root);
    await indexRepository(root);
    console.error('✓ Re-index complete');
  });

program.parse();

function addToGitignore(root: string): void {
  const gitignorePath = path.join(root, '.gitignore');
  const entry = '\n# ContextSliver index\n.sliver/\n';
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    if (!content.includes('.sliver/')) {
      fs.appendFileSync(gitignorePath, entry);
    }
  } else {
    fs.writeFileSync(gitignorePath, entry);
  }
}

function writeMcpConfig(root: string): void {
  const configPath = path.join(root, '.mcp.json');
  const config = {
    mcpServers: {
      contextsliver: {
        command: 'npx',
        args: ['contextsliver', 'start', '--root', root],
        env: {}
      }
    }
  };
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    log(`Created .mcp.json`);
  }
}

function writeClaudeMd(root: string): void {
  const claudeMdPath = path.join(root, 'CLAUDE.md');
  if (!fs.existsSync(claudeMdPath)) {
    const template = fs.readFileSync(
      new URL('../templates/CLAUDE.md', import.meta.url),
      'utf-8'
    );
    fs.writeFileSync(claudeMdPath, template);
    log(`Created CLAUDE.md`);
  }
}
```

---

## 8. MCP TOOL IMPLEMENTATIONS

### Tool: cs_blast_radius (src/mcp/tools/cs_blast_radius.ts)

```typescript
import { z } from 'zod';
import { blastRadius } from '../../graph/traverse.js';
import type { ToolContext } from '../types.js';
import { countTokens } from '../../utils/tokens.js';

const InputSchema = z.object({
  symbol_name: z.string().describe('Exact name of the function or class to analyze'),
  session_id: z.string().optional().describe('Session ID for deduplication. Get from cs_get_context.'),
  max_depth: z.number().min(1).max(4).default(2).describe('How many hops to traverse (default 2)'),
});

export const csBlastRadiusTool = {
  definition: {
    name: 'cs_blast_radius',
    description: [
      'Returns all callers (who uses this symbol) and all dependencies (what this symbol uses)',
      'up to max_depth hops. Use this BEFORE reading any file to understand code connections.',
      'Much cheaper than cat or grep on entire files.',
      'If session_id is provided, already-seen symbols are excluded from the response.'
    ].join(' '),
    inputSchema: {
      type: 'object' as const,
      properties: {
        symbol_name: { type: 'string', description: 'Exact name of the function or class to analyze' },
        session_id: { type: 'string', description: 'Session ID for deduplication' },
        max_depth: { type: 'number', description: 'Traversal depth (default 2, max 4)' },
      },
      required: ['symbol_name'],
    },
  },

  async handler({ args, db, sessionManager }: ToolContext) {
    const { symbol_name, session_id, max_depth } = InputSchema.parse(args);

    // Find symbol by name
    const symbolRow = db.prepare(`
      SELECT s.id FROM symbols s WHERE s.name = ? LIMIT 1
    `).get(symbol_name) as { id: number } | undefined;

    if (!symbolRow) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Symbol '${symbol_name}' not found in index.`,
            hint: 'Try cs_search_symbols to find the correct name, or run cs_index_repo to re-index.',
          })
        }]
      };
    }

    const result = blastRadius(db, symbolRow.id, max_depth);
    if (!result) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Traversal failed' }) }] };
    }

    // Apply session deduplication if session_id provided
    let callers = result.callers;
    let dependencies = result.dependencies;
    let skipped: string[] = [];

    if (session_id) {
      const { fresh: freshCallers, alreadySent: sentCallers } =
        sessionManager.filterAlreadySent(session_id, callers);
      const { fresh: freshDeps, alreadySent: sentDeps } =
        sessionManager.filterAlreadySent(session_id, dependencies);

      callers = freshCallers;
      dependencies = freshDeps;
      skipped = [...sentCallers, ...sentDeps].map((s) => s.name);

      // Mark newly sent symbols as seen
      sessionManager.markAsSent(session_id, [result.symbol, ...callers, ...dependencies]);
    }

    const response = {
      symbol: result.symbol.name,
      file: result.symbol.file_path,
      kind: result.symbol.kind,
      signature: result.symbol.signature,
      callers: callers.map(s => ({ name: s.name, file: s.file_path, kind: s.kind })),
      dependencies: dependencies.map(s => ({ name: s.name, file: s.file_path, kind: s.kind })),
      depth_searched: max_depth,
      ...(skipped.length > 0 ? { already_in_context: skipped } : {}),
    };

    const text = JSON.stringify(response, null, 2);
    const tokenCount = countTokens(text);

    return {
      content: [{
        type: 'text',
        text: `${text}\n\n// ~${tokenCount} tokens`
      }]
    };
  }
};
```

---

## 9. COMPLETE TEST PLAN

### 9.1 Unit tests — Parser golden files (test/unit/parser.test.ts)

```typescript
import { describe, it, expect } from 'vitest';
import { extractSymbols } from '../../src/parser/extractor.js';
import { readFileSync } from 'fs';
import path from 'path';

describe('TypeScript parser', () => {
  it('extracts class and method symbols from simple fixture', () => {
    const source = readFileSync('fixtures/typescript/simple.ts', 'utf-8');
    const expected = JSON.parse(
      readFileSync('fixtures/typescript/expected/simple.json', 'utf-8')
    );
    const result = extractSymbols(source, 'typescript');
    expect(result.symbols).toEqual(expected.symbols);
  });

  it('correctly identifies import edges', () => {
    const source = readFileSync('fixtures/typescript/simple.ts', 'utf-8');
    const result = extractSymbols(source, 'typescript');
    expect(result.edges.some(e => e.kind === 'imports')).toBe(true);
  });

  it('is deterministic — same source always gives same output', () => {
    const source = readFileSync('fixtures/typescript/simple.ts', 'utf-8');
    const r1 = extractSymbols(source, 'typescript');
    const r2 = extractSymbols(source, 'typescript');
    expect(r1).toEqual(r2);
  });
});

describe('Python parser', () => {
  it('extracts functions and classes', () => {
    const source = readFileSync('fixtures/python/simple.py', 'utf-8');
    const result = extractSymbols(source, 'python');
    expect(result.symbols.length).toBeGreaterThan(0);
  });
});
```

### 9.2 Unit tests — Graph traversal (test/unit/graph.test.ts)

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../../src/graph/schema.js';
import { blastRadius } from '../../src/graph/traverse.js';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  return db;
}

function seedSymbol(db: Database.Database, name: string, fileId: number = 1) {
  return db.prepare(`
    INSERT INTO symbols (file_id, name, kind, line_start, line_end)
    VALUES (?, ?, 'function', 1, 10)
  `).run(fileId, name).lastInsertRowid as number;
}

describe('blast radius traversal', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    // Insert a dummy file
    db.prepare(`INSERT INTO files (path, content_hash, indexed_at, language) VALUES (?, ?, ?, ?)`)
      .run('src/test.ts', 'abc123', Date.now(), 'typescript');
  });

  it('returns direct callers and dependencies', () => {
    const authId = seedSymbol(db, 'AuthService');
    const middlewareId = seedSymbol(db, 'AuthMiddleware');
    const userRepoId = seedSymbol(db, 'UserRepository');

    // AuthMiddleware calls AuthService
    db.prepare(`INSERT INTO edges (from_id, to_id, kind) VALUES (?, ?, 'calls')`)
      .run(middlewareId, authId);

    // AuthService calls UserRepository
    db.prepare(`INSERT INTO edges (from_id, to_id, kind) VALUES (?, ?, 'calls')`)
      .run(authId, userRepoId);

    const result = blastRadius(db, authId, 2);

    expect(result).not.toBeNull();
    expect(result!.callers.map(s => s.name)).toContain('AuthMiddleware');
    expect(result!.dependencies.map(s => s.name)).toContain('UserRepository');
  });

  it('terminates on circular dependency graphs — never infinite loops', () => {
    const a = seedSymbol(db, 'A');
    const b = seedSymbol(db, 'B');
    const c = seedSymbol(db, 'C');

    // A → B → C → A (circular)
    db.prepare(`INSERT INTO edges (from_id, to_id, kind) VALUES (?, ?, 'calls')`).run(a, b);
    db.prepare(`INSERT INTO edges (from_id, to_id, kind) VALUES (?, ?, 'calls')`).run(b, c);
    db.prepare(`INSERT INTO edges (from_id, to_id, kind) VALUES (?, ?, 'calls')`).run(c, a);

    // Must complete without throwing or hanging
    expect(() => blastRadius(db, a, 4)).not.toThrow();
    const result = blastRadius(db, a, 4);
    expect(result).not.toBeNull();
  });

  it('respects max_depth — does not return symbols beyond depth cap', () => {
    // Chain: A → B → C → D → E
    const ids = ['A', 'B', 'C', 'D', 'E'].map(n => seedSymbol(db, n));
    for (let i = 0; i < ids.length - 1; i++) {
      db.prepare(`INSERT INTO edges (from_id, to_id, kind) VALUES (?, ?, 'calls')`)
        .run(ids[i], ids[i + 1]);
    }

    const result = blastRadius(db, ids[0], 2);
    const depNames = result!.dependencies.map(s => s.name);

    expect(depNames).toContain('B');
    expect(depNames).toContain('C');
    expect(depNames).not.toContain('D');  // beyond depth 2
    expect(depNames).not.toContain('E');
  });
});
```

### 9.3 Unit tests — Session ledger (test/unit/session.test.ts)

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../../src/graph/schema.js';
import { SessionManager } from '../../src/session/manager.js';

describe('SessionManager', () => {
  let db: Database.Database;
  let manager: SessionManager;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(SCHEMA_SQL);
    manager = new SessionManager(db);
  });

  it('createSession returns a UUID', () => {
    const id = manager.createSession('/project');
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('filterAlreadySent returns all symbols as fresh on first call', () => {
    const sessionId = manager.createSession('/project');
    const symbols = [
      { id: 1, name: 'A', kind: 'function', file_path: 'a.ts',
        line_start: 1, line_end: 5, signature: null, package: null }
    ];
    const { fresh, alreadySent } = manager.filterAlreadySent(sessionId, symbols);
    expect(fresh).toHaveLength(1);
    expect(alreadySent).toHaveLength(0);
  });

  it('filterAlreadySent excludes symbols already sent this session', () => {
    // Seed required foreign key rows first
    db.prepare(`INSERT INTO files (id, path, content_hash, indexed_at, language)
                VALUES (1, 'a.ts', 'hash', ${Date.now()}, 'typescript')`).run();
    db.prepare(`INSERT INTO symbols (id, file_id, name, kind, line_start, line_end)
                VALUES (1, 1, 'AuthService', 'class', 1, 50)`).run();

    const sessionId = manager.createSession('/project');
    const symbols = [
      { id: 1, name: 'AuthService', kind: 'class', file_path: 'a.ts',
        line_start: 1, line_end: 50, signature: null, package: null }
    ];

    manager.markAsSent(sessionId, symbols);

    const { fresh, alreadySent } = manager.filterAlreadySent(sessionId, symbols);
    expect(fresh).toHaveLength(0);
    expect(alreadySent).toHaveLength(1);
    expect(alreadySent[0].name).toBe('AuthService');
  });
});
```

### 9.4 Integration test — stdout purity (test/integration/stdout-purity.test.ts)

```typescript
// CRITICAL TEST: If anything leaks to stdout, the MCP client silently disconnects.
// This test starts the server as a child process and asserts stdout stays clean.

import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import { join } from 'path';

describe('MCP stdout purity', () => {
  it('produces no non-JSON-RPC output on stdout during startup', async () => {
    const server = spawn('node', ['dist/cli.js', 'start', '--root', '/tmp/test-project'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdoutData = '';
    server.stdout.on('data', (chunk) => { stdoutData += chunk.toString(); });

    // Wait 2 seconds for startup
    await new Promise((resolve) => setTimeout(resolve, 2000));
    server.kill();

    // Only valid JSON-RPC or empty is acceptable on stdout
    const lines = stdoutData.split('\n').filter(Boolean);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
```

### 9.5 Benchmark (test/bench/indexing.bench.ts)

```typescript
import { bench, describe } from 'vitest';
import { generateFixture } from '../helpers/fixture-generator.js';
import { indexRepository } from '../../src/parser/index.js';

describe('indexing performance', () => {
  bench('500-file TypeScript repo', async () => {
    const dir = await generateFixture({ files: 500, language: 'typescript' });
    await indexRepository(dir);
  }, { iterations: 3 });

  bench('5,000-file TypeScript repo', async () => {
    const dir = await generateFixture({ files: 5000, language: 'typescript' });
    await indexRepository(dir);
  }, { iterations: 3 });
});
// Target: 500-file repo indexes in < 5 seconds
// Target: 5,000-file repo indexes in < 30 seconds
// Regression alert if either target is exceeded in CI
```

---

## 10. CLAUDE.md TEMPLATE (templates/CLAUDE.md)

```markdown
# ContextSliver — Code Navigation Rules

## How to navigate this codebase (IMPORTANT — read before touching any file)

This project has ContextSliver installed. Before reading any file with Read or
running grep/find to explore code, use the MCP tools below. They cost ~300–800
tokens. Reading a whole file costs 2,000–8,000 tokens and fills your context
window unnecessarily.

### Rule 1: Finding what connects to a symbol
Use `cs_blast_radius` instead of grep.

Example — before editing AuthService:
  cs_blast_radius({ symbol_name: "AuthService", session_id: "YOUR_SESSION_ID" })

This returns who calls AuthService and what AuthService depends on.
Only then read the specific files you actually need.

### Rule 2: Searching for a symbol you don't know the exact location of
Use `cs_search_symbols` instead of find or grep.

Example:
  cs_search_symbols({ query: "token validation", limit: 10 })

### Rule 3: Understanding the current index state
  cs_index_status()

### Rule 4: After making changes
Run the project's test command. Do not assume changes are correct without
running tests.

## Session ID
Get a session ID from the first `cs_get_context` call and pass it to every
subsequent tool call this session. This prevents re-sending context you already
have and saves tokens.

<!-- Keep this file under 200 lines.
     These are nudges, not hard rules. Hard enforcement is via the PreToolUse
     hook in /hooks/pre-tool-use.js — enable it for stricter control. -->
```

---

## 11. MCP CONFIG TEMPLATES

### For Claude Code (templates/mcp-config-claude-code.json)
```json
{
  "mcpServers": {
    "contextsliver": {
      "command": "npx",
      "args": ["contextsliver", "start"],
      "env": {}
    }
  }
}
```
Save as `.mcp.json` in your project root. Claude Code picks it up automatically.

### For Cursor (templates/mcp-config-cursor.json)
```json
{
  "mcpServers": {
    "contextsliver": {
      "command": "npx",
      "args": ["contextsliver", "start"],
      "type": "stdio"
    }
  }
}
```
Save as `.cursor/mcp.json` in your project root.

### For Cline (templates/mcp-config-cline.json)
```json
{
  "mcpServers": {
    "contextsliver": {
      "command": "npx",
      "args": ["contextsliver", "start"],
      "disabled": false,
      "autoApprove": ["cs_blast_radius", "cs_get_context", "cs_search_symbols", "cs_index_status"]
    }
  }
}
```
Add to `~/.vscode/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`.

---

## 12. PHASED ROADMAP

### v0.1 — MVP (Weeks 1–4)
**Goal: one command works, one client supported, two languages indexed**

Deliverables:
- `npx contextsliver init` sets up .sliver/, .mcp.json, CLAUDE.md
- `npx contextsliver start` starts the MCP server on stdio
- TypeScript + JavaScript parsing via Tree-sitter
- Python parsing via Tree-sitter
- SQLite graph with symbols + edges
- Tools: `cs_index_repo`, `cs_get_context`, `cs_blast_radius`, `cs_search_symbols`, `cs_index_status`
- Claude Code integration works end-to-end
- Stdout purity test passes
- Unit tests for parser + traversal + session ledger

Definition of done: a developer can install, init, and have Claude Code use ContextSliver tools instead of raw file reads within 5 minutes.

---

### v0.2 — Incremental indexing + Cursor support (Weeks 5–7)
**Goal: fast re-index on file save, second client working**

Deliverables:
- chokidar file watcher with hash-based dirty flagging
- Incremental re-index on file change (only changed file, not whole repo)
- Session ledger fully operational (delta deduplication across tool calls)
- Cursor integration tested and documented
- Integration tests for MCP protocol responses
- Benchmark suite in CI (500-file and 5k-file targets)

---

### v0.3 — Go + Rust language support + monorepo MVP (Weeks 8–11)
**Goal: language-plugin architecture, contributor-ready**

Deliverables:
- Language plugin architecture documented (add a language = add grammar + tags.scm + fixture)
- Go parsing added via plugin
- Rust parsing added via plugin
- Monorepo workspace detection (npm/pnpm/yarn workspaces)
- Cross-package edge resolution (e.g., `@myorg/ui` → `packages/ui/src/`)
- CONTRIBUTING.md with "how to add a language" guide
- Cline integration tested

---

### v0.4 — PreToolUse hook + Java + token measurement (Weeks 12–15)
**Goal: reliable enforcement + honest benchmarks published**

Deliverables:
- PreToolUse hook (intercepts Read/Grep, nudges toward MCP tools)
- Java parsing added
- Token-reduction benchmark: fixed task on 3 public repos, with/without ContextSliver, methodology published in README
- E2E test harness for token measurement
- npm publish (first public release)

---

### v0.5 — Streamable HTTP + large monorepo performance (Weeks 16–20)
**Goal: team use, 50k-file repo support**

Deliverables:
- Streamable HTTP transport (multi-client, remote use)
- DuckDB optional backend for 50k-file repos
- PageRank-style symbol ranking (prioritize important symbols in budget-limited responses)
- GitHub Copilot integration documented
- Performance validated at 50k files (p95 index time < 60s, query p95 < 200ms)

---

### v1.0 — Stable API + ecosystem (Weeks 20–26)
**Goal: production-ready, community-maintained**

Deliverables:
- Tool schema frozen (v1.0 API — no breaking changes without major version bump)
- Rust engine extraction (optional napi-rs native addon for performance)
- SCIP/LSP optional precision backend
- 8+ languages supported
- Plugin registry (community-contributed language plugins)
- Full documentation site

---

## 13. ENGINEERING RISKS AND MITIGATIONS

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| stdout pollution corrupts MCP | High (easy mistake) | Critical (silent client disconnect) | stdout-purity test in CI; eslint rule banning console.log in src/ |
| Tree-sitter grammar version skew | Medium | High (parsing breaks silently) | Pin grammar versions in package.json; test fixtures catch regressions |
| chokidar EMFILE on large repos | Medium | Medium (watcher crashes) | Respect .gitignore; ignore node_modules/dist by default; catch + retry |
| Circular deps cause infinite traversal | High (common in TS) | High (server hangs) | BFS with visited-set (implemented above); test with circular fixture |
| CLAUDE.md instructions ignored | High | Low (degraded UX, not broken) | Treat as nudge; PreToolUse hook is the reliable enforcement mechanism |
| sqlite write contention (watcher + server concurrent writes) | Medium | Medium (DB locked errors) | WAL mode (already in schema); write-ahead log handles concurrent access |
| MCP SDK breaking changes | Low | Medium | Pin SDK version; test on upgrade in CI |
| Token-count inaccuracy (tiktoken mismatch) | Low | Low | Use js-tiktoken with cl100k_base; label counts as "~approximate" |

---

## 14. WHAT TO BUILD FIRST — AGENT INSTRUCTIONS

If you are an AI agent executing this spec, follow this exact order:

1. Create the repository with `npm init` using the package.json in Section 5
2. Set up TypeScript config (tsconfig.json) targeting ES2022, module: Node16
3. Create the database schema (src/graph/schema.ts — Section 6)
4. Implement the logger first (src/utils/logger.ts — Section 7.4) — nothing else runs safely without it
5. Implement graph traversal (src/graph/traverse.ts — Section 7.1)
6. Implement session manager (src/session/manager.ts — Section 7.2)
7. Implement Tree-sitter extractor for TypeScript (src/parser/extractor.ts + src/parser/languages/typescript.ts)
8. Create fixture files (fixtures/typescript/simple.ts + expected/simple.json)
9. Write and run unit tests (test/unit/graph.test.ts, test/unit/session.test.ts, test/unit/parser.test.ts)
10. Implement MCP server (src/mcp/server.ts — Section 7.3)
11. Implement the five tools (src/mcp/tools/ — Section 8)
12. Implement CLI (src/cli.ts — Section 7.6)
13. Implement file watcher (src/watcher/index.ts — Section 7.5)
14. Write integration test — stdout purity (test/integration/stdout-purity.test.ts — Section 9.4)
15. Test end-to-end with Claude Code using the MCP config template
16. Write CONTRIBUTING.md language-plugin guide
17. Publish to npm as `contextsliver`

Do not skip the stdout-purity test. It is the most common failure mode for MCP servers and it produces no error — the client just silently stops working.
