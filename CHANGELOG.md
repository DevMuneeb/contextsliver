# Changelog

All notable changes to ContextSliver will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.5] - 2026-06-29

### Added
- **GitHub Copilot support.** `init` now also writes `.github/copilot-instructions.md`
  nudging Copilot toward the `cs_*` tools, in addition to `CLAUDE.md` (Claude Code).

### Changed
- **`init` now appends to existing instruction files instead of skipping them.** Previously,
  if `CLAUDE.md` already existed, `init` did nothing — so existing projects got no ContextSliver
  rules. Now it appends a clearly-delimited `<!-- contextsliver:start -->` section, preserving
  the user's existing content. Re-running `init` is idempotent (detected via the marker).

## [0.1.4] - 2026-06-29

### Fixed
- **Critical: `EMFILE: too many open files` error on real projects with dependencies.** The file
  watcher used glob-based ignore patterns, but chokidar v4 dropped glob support for the `ignored`
  option — so `node_modules` was NOT excluded and the watcher tried to track every dependency
  file (thousands), exhausting the OS file-descriptor limit. Replaced with a function-based
  path-segment matcher that correctly excludes `node_modules`, `dist`, `.git`, etc. anywhere in
  the tree. Verified: 0 node_modules files leak through (was 9,335+).

### Added
- `test/unit/watcher-ignore.test.ts` — regression guard for the EMFILE bug, documenting the
  required behavior of the ignore matcher so it can't be silently reverted to globs.

## [0.1.3] - 2026-06-29

### Added
- `CHANGELOG.md` (Keep a Changelog format).
- CI now runs on pull requests via branch protection rules.

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

[Unreleased]: https://github.com/DevMuneeb/contextsliver/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/DevMuneeb/contextsliver/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/DevMuneeb/contextsliver/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/DevMuneeb/contextsliver/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/DevMuneeb/contextsliver/releases/tag/v0.1.1
