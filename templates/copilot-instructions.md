# ContextSliver — Code Navigation Rules

This project has ContextSliver installed (an MCP server that indexes the codebase into a
dependency graph). Before reading files with the editor or running search/grep to explore code,
prefer the ContextSliver MCP tools — they return only the connected subgraph relevant to your
task and cost far fewer tokens than reading whole files.

## Tools available

- **`cs_get_context`** — get a symbol's definition + its immediate callers/dependencies. Use this
  to start a session; it returns a `session_id` to pass to later calls.
- **`cs_blast_radius`** — all callers + dependencies up to N hops. Use before editing a symbol to
  understand its blast radius.
- **`cs_search_symbols`** — find symbols by name/path. Use instead of find/grep.
- **`cs_index_status`** — check index health.
- **`cs_index_repo`** — force a re-index if the index is stale.

## Rules

1. Before editing a symbol, call `cs_blast_radius` for it — then read only the specific files you
   actually need.
2. Pass the `session_id` from your first `cs_get_context` call to every subsequent `cs_*` call;
   this skips context you already have.
3. Prefer `cs_search_symbols` over repo-wide search when locating a known symbol.

See https://github.com/DevMuneeb/contextsliver for full docs.
