# ContextSliver

> On-demand context management for AI coding agents. Stop reading whole files — ask for the connected subgraph instead.

[![CI](https://github.com/muneeburrehman/contextsliver/actions/workflows/ci.yml/badge.svg)](https://github.com/muneeburrehman/contextsliver/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/contextsliver.svg)](https://www.npmjs.com/package/contextsliver)

## The problem

When you ask an AI coding agent (Claude Code, Cursor, Cline) to *"fix the bug in AuthService,"* it
repeatedly reads entire files to find the 5% that's relevant — burning 40,000–80,000 tokens on a
question that needed ~3,000.

```text
find . -name "*.ts"   → 2,000 tokens (a file listing)
cat AuthService.ts    → 3,000 tokens (whole file)
grep -r "AuthService" → 5,000 tokens (40 matches)
cat AuthMiddleware.ts → 2,500 tokens (whole file, again)
... × 10 more ...
```

Existing tools don't fully fix it: Graphify dumps one enormous whole-repo map into context up front;
Repomix packs the entire repo into one file; Aider's repo-map sends a whole-repo summary with every
message. **None of them track what the agent has already seen this session.**

## What ContextSliver does

ContextSliver runs as a background **MCP server** on your machine. It indexes your codebase into a
local SQLite graph of every function, class, and import. When the agent needs context, it calls an
MCP tool instead of reading files:

```text
Agent:   "What connects to AuthService? Budget: 2,000 tokens."

ContextSliver:
  symbol:        AuthService  (src/auth/AuthService.ts)
  callers:       [AuthMiddleware, LoginController]      ← who uses it
  dependencies:  [UserRepository, TokenService]         ← what it uses
  already_in_context: [UserRepository]                  ← skipped, agent already has it
  // ~380 tokens
```

Three things make it different:

1. **On-demand pruning** — never sends the whole graph, only the connected subgraph for the task.
2. **Session ledger** — tracks what the agent has already seen and skips re-sending it.
3. **One-command setup** — `npx contextsliver init`. No database server, no API key.

## Quickstart

```bash
# In your project root:
npx contextsliver init      # creates .sliver/, .mcp.json, CLAUDE.md, indexes the repo
npx contextsliver start     # runs the MCP server + file watcher (stdio)
```

Then restart Claude Code / Cursor / Cline — they'll pick up the five tools automatically. See the
[templates](./templates) for client-specific config.

## The five MCP tools

| Tool | What it does | Typical tokens |
|------|-------------|---------------|
| `cs_index_repo` | Trigger a full re-index | ~50 |
| `cs_get_context` | Symbol definition + immediate connections | ~300–800 |
| `cs_blast_radius` | All callers + dependents up to N hops | ~500–2,000 |
| `cs_search_symbols` | Full-text search across indexed symbols | ~200–600 |
| `cs_index_status` | Index health, file count, last-updated | ~100 |

Pass the `session_id` from your first `cs_get_context` call to every subsequent call to enable
deduplication.

## Supported languages

- **TypeScript / JavaScript / TSX** (v0.1)
- **Python** (v0.1)
- Go, Rust, Java — planned (see [roadmap](#roadmap))

Adding a language = add a grammar package + a `grammars/<lang>/tags.scm` query + a fixture. See
[CONTRIBUTING.md](./CONTRIBUTING.md).

## How it works

```text
Your codebase  ──chokidar──▶  Parser (Tree-sitter)  ──▶  SQLite graph (.sliver/index.db)
                                                                    │
                              MCP server (stdio) ◀──────────────────┘
                                    │   session ledger (.sliver/sessions.db)
                                    ▼
                          Claude Code / Cursor / Cline
```

- **Parser**: Tree-sitter extracts symbols + imports per file.
- **Graph engine**: stores symbol→symbol edges; bidirectional BFS (`blastRadius`) for blast radius
  with cycle detection.
- **Session manager**: per-session ledger computes deltas so already-sent context is skipped.
- **MCP server**: exposes the five tools over stdio.

## Token counting

Counts use [`gpt-tokenizer`](https://www.npmjs.com/package/gpt-tokenizer) (`cl100k_base`) and are
labeled **~approximate** — close enough for budget guidance, not billing.

## Development

```bash
npm install
npm test            # unit + integration tests
npm run test:bench  # indexing benchmarks
npm run build       # tsc → dist/
npm run lint        # eslint
```

Requires Node ≥ 20.

## Roadmap

- **v0.1** ✅ TS/JS + Python, SQLite graph, session ledger, 5 tools, CLI, watcher
- **v0.2** — incremental indexing polish, Cursor integration, CI benchmarks
- **v0.3** — Go + Rust, monorepo workspace resolution, language-plugin docs
- **v0.4** — PreToolUse hook, Java, published token-reduction benchmarks
- **v0.5** — Streamable HTTP transport, DuckDB backend for 50k-file repos, PageRank ranking
- **v1.0** — frozen API, optional native (napi-rs) engine, SCIP/LSP precision backend

See [`contextsliver-spec.md`](./contextsliver-spec.md) for the full specification.

## License

MIT © Muneeb Ur Rehman
