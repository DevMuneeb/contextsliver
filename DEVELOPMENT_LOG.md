# ContextSliver — Development Retrospective

A complete record of what was built, why, how it works, and how to operate it.

---

## 1. The Problem We Solved

### The core issue with AI coding agents today

When you ask an AI coding agent (Claude Code, Cursor, Cline) to *"fix the bug in AuthService,"*
it has no map of your codebase. So it explores blindly:

```
find . -name "*.ts"   → 2,000 tokens   (just a file listing)
cat AuthService.ts    → 3,000 tokens   (reads the WHOLE file)
grep -r "AuthService" → 5,000 tokens   (40 matches, mostly noise)
cat AuthMiddleware.ts → 2,500 tokens   (whole file, AGAIN)
... × 10 more files ...
```

**Result:** 40,000–80,000 tokens burned on a question that needed ~3,000. The agent re-reads the
same files repeatedly across a session, and has no memory of what it already saw.

### Why existing tools don't fully fix this

| Tool | What it does | The gap |
|------|-------------|---------|
| **Graphify** | Dumps one giant whole-repo map into context upfront | Wastes tokens on code you don't need for THIS task |
| **Repomix** | Packs the entire repo into one file | Same — no on-demand pruning |
| **Aider repo-map** | Sends a whole-repo summary with every message | No session memory; re-sends everything |
| **grep / cat** | Manual file reading | No graph awareness; re-reads duplicates |

**None of them:**
1. Return only the connected subgraph relevant to the current task
2. Track what the agent has already seen this session

---

## 2. What We Built — The Solution

**ContextSliver** is an MCP (Model Context Protocol) server that indexes your codebase into a
local SQLite graph and gives the agent 5 tools to query it on-demand — with session-aware
deduplication.

### The five MCP tools

| Tool | Purpose | Typical cost |
|------|---------|-------------|
| `cs_get_context` | Symbol definition + 1-hop neighbors; starts a session | ~300–800 tokens |
| `cs_blast_radius` | All callers + dependencies up to N hops | ~500–2,000 tokens |
| `cs_search_symbols` | Find symbols by name/path (replaces grep) | ~200–600 tokens |
| `cs_index_status` | Index health, file/symbol/edge counts | ~100 tokens |
| `cs_index_repo` | Force a full re-index | ~50 tokens |

### v0.1 feature set (complete)

- ✅ **TypeScript / JavaScript / TSX + Python parsing** (Tree-sitter)
- ✅ **SQLite graph** of every symbol + their relationships (calls/imports/extends/implements)
- ✅ **Session ledger** — per-session deduplication (the differentiator)
- ✅ **Bidirectional BFS traversal** with cycle detection
- ✅ **Incremental file watcher** (hash-based skip of unchanged files)
- ✅ **CLI** (`init` / `start` / `reindex`)
- ✅ **46 passing tests** (unit + integration + performance)
- ✅ **CI + automated npm publishing**

---

## 3. How It Works (Architecture)

```
Your codebase  ──chokidar──▶  Parser (Tree-sitter)  ──▶  SQLite graph (.sliver/index.db)
                                                                    │
                              MCP server (stdio) ◀──────────────────┘
                                    │   session ledger (.sliver/sessions.db)
                                    ▼
                          Claude Code / Cursor / Cline
```

### The pipeline, step by step

**1. Indexing (`npx contextsliver init`)**
- Walks the project (skipping `node_modules`, `dist`, `.git`, etc.)
- For each file, runs a **Tree-sitter query** (`grammars/<lang>/tags.scm`) to extract:
  - Symbols: functions, classes, interfaces, types, variables
  - Imports: source specifier + imported names
  - Inheritance: class extends/implements clauses
- Stores symbols in SQLite; resolves cross-file imports + inheritance into symbol→symbol edges
- Hashes file content (SHA-256) so unchanged files are skipped on re-index

**2. Serving (`npx contextsliver start`)**
- Opens `.sliver/index.db`, starts the MCP server over stdio
- The file watcher runs alongside it for live re-indexing on save
- The agent's client (Claude Code) connects and discovers the 5 tools

**3. Querying (when the agent calls a tool)**
- `cs_blast_radius(AuthService)` → bidirectional BFS from AuthService
  - **Callers** (reverse edges): who uses AuthService
  - **Dependencies** (forward edges): what AuthService uses
  - Cycle-safe (visited set prevents infinite loops on circular imports)
- If a `session_id` is passed → symbols already sent are excluded and listed in
  `already_in_context`, saving tokens

### Key correctness rule

**stdout is the JSON-RPC protocol channel.** Any stray `console.log()` corrupts the stream and
silently disconnects the agent. We enforce this with:
- An eslint `no-console` rule (only `console.error` allowed)
- A dedicated `stdout-purity` integration test that spawns the server and asserts every stdout
  line is valid JSON-RPC

---

## 4. How It's Better (vs alternatives)

| | grep / cat | Graphify / Repomix | **ContextSliver** |
|---|---|---|---|
| On-demand (only relevant subgraph) | ❌ manual | ❌ whole repo | ✅ yes |
| Session memory (skip seen symbols) | ❌ | ❌ | ✅ yes |
| Graph-aware (callers/dependencies) | ❌ | partial | ✅ yes |
| Cost per query | 2,000–8,000 tok | high upfront | ~300–800 tok |
| Setup | n/a | config | `npx contextsliver init` |
| Runs locally | n/a | varies | ✅ SQLite, no server |

**The three differentiators:**
1. **On-demand pruning** — never sends the whole graph, only the connected subgraph for the task
2. **Session ledger** — tracks what the agent has already seen and skips re-sending it
3. **One-command setup** — `npx contextsliver init`. No database server, no API key

### Spec corrections we made (the spec was wrong in 4 places)

During planning, we researched the actual current APIs and found the spec's dependency
assumptions were stale. We corrected:

1. **MCP SDK** — spec used the legacy low-level `Server` API; we used the current
   `McpServer.registerTool()` + Zod (v1.29)
2. **Tree-sitter** — spec referenced `tree-sitter-language-pack` which **doesn't exist on npm**;
   we used individual grammar packages with the `new Query()` API
3. **Token counting** — spec used `js-tiktoken` (WASM); we used `gpt-tokenizer` (pure JS, lighter)
4. **Package versions** — aligned tree-sitter runtime + grammars via npm `overrides` to resolve
   inconsistent peer-dep ranges

---

## 5. How to Deploy & Publish (Operations Runbook)

### For users (install ContextSliver in their project)

```bash
# In their project root:
npx contextsliver init      # creates .sliver/, .mcp.json, CLAUDE.md, indexes the repo
npx contextsliver start     # runs the MCP server + file watcher
```
Then restart Claude Code / Cursor / Cline to pick up the tools.

### For maintainers (release a new version)

The publishing pipeline is **fully automated** via GitHub Actions. To release a new version:

```bash
npm version patch          # 0.1.2 → 0.1.3  (use "minor" for 0.2.0, "major" for 1.0.0)
git push --follow-tags
```

That's it. The tag push triggers `publish.yml`, which:
1. Checks out the code
2. Runs `npm install`
3. Runs **lint → typecheck → build → test** (all must pass)
4. Publishes to npm using the `NPM_TOKEN` secret
5. The new version is live within ~40 seconds

### The NPM_TOKEN secret (already configured)

The token is a **Granular Access Token with 2FA bypass for CI**, stored as a GitHub Actions
secret. To rotate it:
1. npmjs.com → Access Tokens → generate new Granular token (scoped to `contextsliver`)
2. github.com/DevMuneeb/contextsliver/settings/secrets/actions → update `NPM_TOKEN`

### CI workflows

| Workflow | File | Triggers on | Does |
|----------|------|------------|------|
| **CI** | `ci.yml` | PR / push to main | lint + typecheck + build + test (Node 20 + 22, ubuntu + macOS) |
| **Publish** | `publish.yml` | version tag (`v*`) | CI checks + npm publish |

---

## 6. Development Log — Day by Day

A record of what was built across the development of v0.1.

### Day 1 — Planning & Research
- Read the full spec (`contextsliver-spec.md`)
- **Researched current APIs** of the two riskiest dependencies:
  - MCP SDK: confirmed v1.29, discovered spec's low-level API is legacy; documented
    `McpServer.registerTool` + Zod pattern
  - Tree-sitter: discovered `tree-sitter-language-pack` **doesn't exist on npm**; documented
    individual grammar packages + `new Query()` API
- Produced a detailed plan with all spec corrections flagged
- Got plan approved

### Day 2 — Repo Bootstrap
- **Fixed a critical git issue**: the project's `.git` was resolving to the home directory,
  leaking the entire home dir into git status. Initialized an isolated repo in the project folder
- Scaffolded: `package.json` (corrected deps), `tsconfig.json`, `vitest.config.ts`,
  `.eslintrc.json` (with `no-console` rule), `.prettierrc`, `.gitignore`, `.npmignore`,
  MIT `LICENSE`, `README.md`, `CONTRIBUTING.md`
- Installed dependencies; **verified native bindings** (better-sqlite3, tree-sitter, grammars)
  load and parse correctly
- First commit

### Day 3 — Core Utilities + Graph Engine
- `utils/logger.ts` — stderr-only logging (the critical MCP correctness rule)
- `utils/paths.ts` — import-path resolution
- `utils/tokens.ts` — token counting via gpt-tokenizer
- `graph/schema.ts` — SQLite schema (files/symbols/edges/sessions/ledger_entries)
- `graph/store.ts` — CRUD with cached prepared statements
- `graph/traverse.ts` — bidirectional BFS with cycle detection
- `graph/rank.ts` — stub (PageRank deferred to v0.5)
- **6 graph tests passing** (including circular-dependency cycle termination)

### Day 4 — Session Ledger + Parser
- `session/manager.ts` — per-session ledger, `filterAlreadySent` delta computation
- `session/pruner.ts` — builds fresh-vs-skipped response payloads
- **11 session tests passing** (including cross-session isolation)
- `parser/extractor.ts` — Tree-sitter query → symbols + imports
- `grammars/{typescript,python}/tags.scm` — queries (debugged several compile errors:
  invalid node types, conflicting patterns)
- `parser/languages/` — plugin registry + typescript/python plugins
  - Fixed a **circular import** (registry ↔ plugins) by splitting out `query-loader.ts`
- `parser/index.ts` — `indexRepository` with import/inheritance edge resolution
  - Fixed an **ESM `require()` bug** in path resolution
  - Fixed the **import edge model** (imports connect file-level symbols, not non-existent symbols)
- Golden-file fixtures + tests; **22 parser/indexer/hasher tests passing**

### Day 5 — MCP Server + CLI + Tools
- `mcp/server.ts` — McpServer + StdioServerTransport, wires store + session manager + watcher
- 5 tools: `cs_get_context`, `cs_blast_radius`, `cs_search_symbols`, `cs_index_status`, `cs_index_repo`
- `watcher/index.ts` — chokidar v4 debounced incremental re-index
- `cli.ts` — `init` / `start` / `reindex` commands
- `templates/` — CLAUDE.md + mcp-config files for Claude Code / Cursor / Cline
- **Verified end-to-end**: init indexes a project; MCP server responds to real initialize →
  tools/list → tools/call; stdout purity confirmed (0 non-JSON-RPC bytes)

### Day 6 — Integration Tests + CI + Publishing
- `stdout-purity.test.ts` — CRITICAL guard (spawns server, asserts all stdout is JSON-RPC)
- `mcp-protocol.test.ts` — full round-trip protocol tests
- `performance.test.ts` — 500-file indexing regression guard (3.1s observed, 20s cap)
- Benchmark suite + fixture generator
- `.github/workflows/ci.yml` + `publish.yml`
- **46 tests passing, 1 skipped** (v0.4 token-reduction scaffold)
- **Published to GitHub** as DevMuneeb/contextsliver (public)
- **Fixed commit attribution** — rewrote history via filter-branch so all commits show DevMuneeb
- **Published 0.1.1 to npm**

### Day 7 — UX Polish + Automated Publishing
- **Fixed version bug** — CLI was hardcoding 0.1.0; now reads from package.json dynamically
- **Added native module health check** — startup check + postinstall hint so users with blocked
  install scripts (npm v10+ default) get clear rebuild instructions instead of a cryptic crash
- **Set up automated CI publishing** — added `NPM_TOKEN` secret; tag-push now auto-publishes
- **Published 0.1.2 via CI** — fully automated, verified end-to-end
- Verified `npx contextsliver@0.1.2` works from a clean install

---

## 7. Roadmap (deferred to later versions)

- **v0.2** — incremental indexing polish, Cursor integration, CI benchmarks
- **v0.3** — Go + Rust, monorepo workspace resolution, language-plugin docs
- **v0.4** — PreToolUse hook, Java, published token-reduction benchmarks
- **v0.5** — Streamable HTTP transport, DuckDB backend for 50k-file repos, PageRank ranking
- **v1.0** — frozen API, optional native (napi-rs) engine, SCIP/LSP precision backend

See `contextsliver-spec.md` §12 and `README.md` for the full roadmap.

---

## Quick Links

- **Repo:** https://github.com/DevMuneeb/contextsliver
- **npm:** https://www.npmjs.com/package/contextsliver
- **Spec:** `contextsliver-spec.md`
- **Actions:** https://github.com/DevMuneeb/contextsliver/actions
