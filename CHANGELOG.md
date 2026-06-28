# Changelog

All notable changes to ContextSliver will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] - 2026-06-28

### Added
- Dynamic version reading from `package.json` (CLI no longer reports a stale hardcoded version).
- Native module health check on server startup: surfaces missing `better-sqlite3` / `tree-sitter`
  binaries (e.g. when npm v10+ blocks install scripts) with clear rebuild instructions instead of
  a cryptic crash.
- Postinstall hint that detects unbuilt native modules and prints the `npm rebuild` command.

## [0.1.1] - 2026-06-28

### Added
- Initial public release of ContextSliver.
- TypeScript / JavaScript / TSX and Python parsing via Tree-sitter.
- SQLite dependency graph (files, symbols, edges) with bidirectional BFS traversal and
  cycle detection.
- Per-session context ledger for deduplication (the core differentiator).
- Five MCP tools: `cs_get_context`, `cs_blast_radius`, `cs_search_symbols`,
  `cs_index_status`, `cs_index_repo`.
- CLI with `init`, `start`, and `reindex` commands.
- Incremental file watcher with hash-based skip of unchanged files.
- Client templates for Claude Code, Cursor, and Cline.
- 46 passing unit + integration tests, including a stdout-purity guard.
- CI (lint + typecheck + build + test on Node 20/22, ubuntu + macOS) and automated
  npm publishing on version tags.

[Unreleased]: https://github.com/DevMuneeb/contextsliver/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/DevMuneeb/contextsliver/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/DevMuneeb/contextsliver/releases/tag/v0.1.1
