#!/usr/bin/env node
// ContextSliver CLI entry point. This is what `npx contextsliver <command>` runs.
//
// Commands:
//   init     Set up the project: create .sliver/, append .gitignore, write .mcp.json +
//            CLAUDE.md, run the initial index.
//   start    Run the MCP server (stdio) + file watcher. The agent connects to this.
//   reindex  Force a full re-index.
//
// Logging uses console.error (stderr) directly for user-facing CLI messages, and the log()
// helper for server-internal diagnostics. Neither touches stdout except the MCP transport.
import { Command } from 'commander';
import { join, resolve, sep } from 'node:path';
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startMCPServer } from './mcp/server.js';
import { GraphStore } from './graph/store.js';
import { indexRepository } from './parser/index.js';
import { log } from './utils/logger.js';

// Read version from package.json so the CLI never reports a stale hardcoded value.
// Resolves relative to the compiled module (dist/cli.js → ../package.json), with a fallback
// for development (src/cli.ts → ../package.json).
function readVersion(): string {
  const here = fileURLToPath(import.meta.url);
  const dir = here.slice(0, here.lastIndexOf('/'));
  const candidates = [join(dir, '..', 'package.json'), join(dir, '..', '..', 'package.json')];
  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf-8'));
      if (pkg.version) return pkg.version;
    } catch {
      // try next
    }
  }
  return '0.0.0-unknown';
}

const VERSION = readVersion();

const program = new Command();

program
  .name('contextsliver')
  .description('Universal context-management MCP server for AI coding agents')
  .version(VERSION);

// ── init ──────────────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Initialize ContextSliver for the current project')
  .option('--root <path>', 'Project root directory', process.cwd())
  .option('--no-index', 'Skip the initial index (index later with `reindex`)')
  .action(async (opts) => {
    const root = resolve(opts.root);
    console.error(`Initializing ContextSliver in ${root}`);

    // 1. .sliver/
    mkdirSync(join(root, '.sliver'), { recursive: true });

    // 2. .gitignore
    addToGitignore(root);

    // 3. .mcp.json
    writeMcpConfig(root);

    // 4. Agent instruction files. We create/append for each supported agent so its rules nudge
    //    the agent toward the cs_* tools. writeAgentInstruction is idempotent.
    writeClaudeMd(root);
    writeAgentInstruction(root, '.github/copilot-instructions.md', 'copilot-instructions.md');

    // 5. Initial index
    if (opts.index) {
      console.error('Indexing project (this may take a few seconds for large repos)...');
      const dbPath = join(root, '.sliver', 'index.db');
      // Use better-sqlite3 directly to avoid spinning up the MCP server.
      const Database = (await import('better-sqlite3')).default;
      const db = new Database(dbPath);
      const store = new GraphStore(db);
      const result = indexRepository(store, root, { force: true });
      console.error(
        `✓ Indexed ${result.filesIndexed} file(s), ${result.symbols} symbols, ${result.edges} edges`,
      );
      db.close();
    }

    console.error('\n✓ ContextSliver initialized.');
    console.error('  Next: restart Claude Code / Cursor to pick up the MCP server, then run:');
    console.error('    npx contextsliver start');
  });

// ── start ────────────────────────────────────────────────────────────────────
program
  .command('start')
  .description('Start the ContextSliver MCP server and file watcher')
  .option('--root <path>', 'Project root directory', process.cwd())
  .option('--no-watch', 'Disable the file watcher')
  .action(async (opts) => {
    const root = resolve(opts.root);
    log(`Starting ContextSliver MCP server in ${root}`);
    await startMCPServer({ projectRoot: root, watch: opts.watch });
  });

// ── reindex ──────────────────────────────────────────────────────────────────
program
  .command('reindex')
  .description('Force a full re-index of the project')
  .option('--root <path>', 'Project root directory', process.cwd())
  .option('--force', 'Re-parse every file even if its hash is unchanged', true)
  .action(async (opts) => {
    const root = resolve(opts.root);
    mkdirSync(join(root, '.sliver'), { recursive: true });
    const dbPath = join(root, '.sliver', 'index.db');
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath);
    const store = new GraphStore(db);
    const result = indexRepository(store, root, { force: opts.force });
    console.error(
      `✓ Re-indexed: ${result.filesIndexed} file(s) indexed, ${result.filesSkipped} skipped, ` +
        `${result.symbols} symbols, ${result.edges} edges in ${result.durationMs}ms`,
    );
    db.close();
  });

program.parse();

// ── init helpers ─────────────────────────────────────────────────────────────

function addToGitignore(root: string): void {
  const gitignorePath = join(root, '.gitignore');
  const entry = '\n# ContextSliver index\n.sliver/\n';
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, 'utf-8');
    if (!content.includes('.sliver/')) {
      appendFileSync(gitignorePath, entry);
    }
  } else {
    writeFileSync(gitignorePath, entry.trimStart());
  }
}

function writeMcpConfig(root: string): void {
  const configPath = join(root, '.mcp.json');
  if (existsSync(configPath)) {
    log('Skipped .mcp.json (already exists)');
    return;
  }
  const config = {
    mcpServers: {
      contextsliver: {
        command: 'npx',
        args: ['contextsliver', 'start', '--root', root],
        env: {},
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  log('Created .mcp.json');
}

function writeClaudeMd(root: string): void {
  writeAgentInstruction(root, 'CLAUDE.md', 'CLAUDE.md');
}

/**
 * Write (or append to) a code-agent instruction file.
 *
 * Behavior:
 *   - If the file does NOT exist → create it from the template.
 *   - If the file exists but does NOT contain a ContextSliver marker → APPEND the template
 *     section (so we don't clobber the user's existing instructions, but still add our rules).
 *   - If the file exists and already contains our marker → skip (idempotent on re-run).
 *
 * The marker lets us detect a previously-injected section so re-running `init` is safe.
 */
function writeAgentInstruction(
  root: string,
  relativePath: string,
  templateName: string,
): void {
  const absPath = join(root, relativePath);
  const SECTION_MARKER = '<!-- contextsliver:start -->';
  const template = readTemplate(templateName);

  if (!existsSync(absPath)) {
    // Ensure parent dirs exist (e.g. .github/copilot-instructions.md needs .github/).
    const parent = absPath.slice(0, absPath.lastIndexOf(sep));
    if (parent && !existsSync(parent)) mkdirSync(parent, { recursive: true });
    writeFileSync(absPath, template);
    log(`Created ${relativePath}`);
    return;
  }

  const existing = readFileSync(absPath, 'utf-8');
  if (existing.includes(SECTION_MARKER)) {
    log(`Skipped ${relativePath} (ContextSliver section already present)`);
    return;
  }
  // Append our section, clearly delimited so future init runs can detect and update it.
  const appended = `${existing.trimEnd()}\n\n${SECTION_MARKER}\n${template}\n<!-- contextsliver:end -->\n`;
  writeFileSync(absPath, appended);
  log(`Updated ${relativePath} (appended ContextSliver section)`);
}

/** Read a file from templates/, resolving whether we're running from src/ or dist/. */
function readTemplate(name: string): string {
  const here = fileURLToPath(import.meta.url);
  const dir = here.slice(0, here.lastIndexOf('/'));
  // src/cli.ts → ../templates ; dist/cli.js → ../templates
  const candidates = [
    join(dir, '..', 'templates', name),
    join(dir, '..', '..', 'templates', name),
    join(process.cwd(), 'templates', name),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return readFileSync(candidate, 'utf-8');
  }
  // Fallback: an inline minimal template so init never fails just because the file is missing.
  return [
    '# ContextSliver — Code Navigation Rules',
    '',
    'This project has ContextSliver installed. Before reading files or running grep/find,',
    'use the cs_* MCP tools (cs_get_context, cs_blast_radius, cs_search_symbols) to get just',
    'the connected subgraph. Pass the session_id from your first cs_get_context call to every',
    'subsequent call to skip context you already have.',
    '',
  ].join('\n');
}
