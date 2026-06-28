// Parser entry point: indexFile + indexRepository.
//
// indexFile: parse one file, persist its symbols to the graph (idempotent — re-indexing a file
//   replaces its symbols).
// indexRepository: walk the project tree, index every supported file, then resolve all
//   cross-file imports + class inheritance into symbol→symbol edges.
//
// Edge resolution (v0.1 scope): we resolve RELATIVE imports ('./x', '../y') to target files on
// disk and create 'imports' edges between same-named symbols. We also create 'extends'/'implements'
// edges from class symbols to their base/interface names when those resolve to known symbols.
// Bare specifiers ('react', '@myorg/ui') are deferred to monorepo resolution (v0.3) — we record
// the import but don't create an edge.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { GraphStore } from '../graph/store.js';
import { extractSymbols } from './extractor.js';
import { pluginForFile } from './languages/registry.js';
import { resolveRelativeImport, toPosix } from '../utils/paths.js';
import { log } from '../utils/logger.js';
import type { ExtractedSymbol, ExtractedImport } from './types.js';
import type { EdgeKind } from '../graph/types.js';

/** Default ignored directories during indexing. */
export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.sliver',
  'dist',
  'build',
  'out',
  '__pycache__',
  '.next',
  '.nuxt',
  'coverage',
  '.cache',
  '.turbo',
  '.verdaccio',
]);

const IGNORED_SUFFIXES = ['.min.js', '.min.css', '.map'];

/** Index a single file into the store (replaces its prior symbols). Returns the file id. */
export function indexFile(
  store: GraphStore,
  projectRoot: string,
  absoluteFilePath: string,
  source: string,
  contentHash: string,
): { fileId: number; symbolIds: { name: string; id: number }[] } | null {
  const relPath = toPosix(relative(resolve(projectRoot), absoluteFilePath));
  const plugin = pluginForFile(relPath);
  if (!plugin) return null;

  let parseResult;
  try {
    parseResult = extractSymbols(source, plugin, relPath);
  } catch (err) {
    log(`Failed to parse ${relPath}: ${(err as Error).message}`, 'warn');
    return null;
  }

  return store.transaction(() => {
    const fileId = store.upsertFile(relPath, contentHash, plugin.id);
    store.deleteFileSymbols(fileId); // clean slate for this file

    const symbolIds: { name: string; id: number }[] = [];
    for (const sym of parseResult.symbols) {
      const id = store.insertSymbol({
        file_id: fileId,
        name: sym.name,
        kind: sym.kind,
        line_start: sym.line_start,
        line_end: sym.line_end,
        signature: sym.signature,
        package: null,
      });
      symbolIds.push({ name: sym.name, id });
    }

    return { fileId, symbolIds };
  });
}

export interface IndexOptions {
  /** Force re-index even when the stored content hash matches. */
  force?: boolean;
}

export interface IndexResult {
  filesIndexed: number;
  filesSkipped: number;
  symbols: number;
  edges: number;
  durationMs: number;
}

/**
 * Index an entire project: walk supported files, parse each, persist symbols, then resolve
 * cross-file imports + inheritance into edges.
 */
export function indexRepository(
  store: GraphStore,
  projectRoot: string,
  opts: IndexOptions = {},
): IndexResult {
  const start = Date.now();
  const root = resolve(projectRoot);
  const files = collectSupportedFiles(root);
  log(`Indexing ${files.length} file(s) under ${root}`);

  // 1) Parse + persist symbols (and remember per-file imports for the edge pass).
  const fileMeta = new Map<
    string,
    {
      fileId: number;
      symbolsByName: Map<string, number>;
      imports: ExtractedImport[];
      symbols: ExtractedSymbol[];
    }
  >();

  let filesIndexed = 0;
  let filesSkipped = 0;

  for (const absPath of files) {
    const relPath = toPosix(relative(root, absPath));
    const source = safeRead(absPath);
    if (source === null) continue;

    const contentHash = sha256(source);
    if (!opts.force) {
      const existing = store.getFileHash(relPath);
      if (existing === contentHash) {
        filesSkipped++;
        // Still need fileMeta for edge resolution if symbols already exist.
        hydrateFileMeta(store, relPath, fileMeta);
        continue;
      }
    }

    const result = indexFile(store, root, absPath, source, contentHash);
    if (!result) continue;
    filesIndexed++;

    const plugin = pluginForFile(relPath)!;
    let parseResult;
    try {
      parseResult = extractSymbols(source, plugin, relPath);
    } catch {
      parseResult = { symbols: [], imports: [] };
    }

    const symbolsByName = new Map<string, number>();
    for (const { name, id } of result.symbolIds) symbolsByName.set(name, id);
    fileMeta.set(relPath, {
      fileId: result.fileId,
      symbolsByName,
      imports: parseResult.imports,
      symbols: parseResult.symbols,
    });
  }

  // 2) Resolve imports → edges.
  //
  // An import "file A imports symbol X from file B" doesn't name a symbol in A — A merely
  // references X. Our edges are symbol→symbol, so we model this as: every top-level symbol in A
  // (which lives in A's module scope and may reference X) gets an 'imports' edge to X in B.
  // This is an over-approximation (not every symbol in A uses X) but it's sound for v0.1's
  // "what does this symbol connect to?" traversal; precise call-graph edges land in a later phase.
  let edges = 0;
  const topLevelsOf = (meta: { symbolsByName: Map<string, number>; symbols: ExtractedSymbol[] }) =>
    meta.symbols
      .filter((s) => s.kind === 'class' || s.kind === 'interface' || s.kind === 'type' || s.kind === 'function' || s.kind === 'variable')
      .map((s) => meta.symbolsByName.get(s.name))
      .filter((id): id is number => id !== undefined);

  for (const [importerRel, meta] of fileMeta) {
    const importerTopLevels = topLevelsOf(meta);

    for (const imp of meta.imports) {
      const targetRel = resolveRelativeImport(imp.specifier, importerRel, root);
      if (!targetRel) continue; // bare/builtin or not found on disk
      const targetMeta = fileMeta.get(targetRel);
      if (!targetMeta) continue;
      for (const name of imp.names) {
        const toId = targetMeta.symbolsByName.get(name);
        if (toId === undefined) continue;
        // Connect every top-level importer symbol to the imported symbol.
        for (const fromId of importerTopLevels) {
          store.insertEdge(fromId, toId, 'imports');
          edges++;
        }
      }
    }

    // 3) Resolve class inheritance edges (extends/implements) within the file.
    for (const sym of meta.symbols) {
      if (sym.kind !== 'class') continue;
      const fromId = meta.symbolsByName.get(sym.name);
      if (!fromId) continue;
      for (const edgeKind of ['extends', 'implements'] as const) {
        const targets = edgeKind === 'extends' ? sym.extends : sym.implements;
        for (const targetName of targets ?? []) {
          // resolve in this file first, else any symbol with that name
          let toId = meta.symbolsByName.get(targetName);
          if (!toId) {
            const found = store.findSymbolByName(targetName);
            if (found) toId = found.id;
          }
          if (toId) {
            store.insertEdge(fromId, toId, edgeKind as EdgeKind);
            edges++;
          }
        }
      }
    }
  }

  const stats = store.stats();
  const durationMs = Date.now() - start;
  log(
    `Index done: ${filesIndexed} indexed, ${filesSkipped} skipped, ` +
      `${stats.symbols} symbols, ${edges} new edges in ${durationMs}ms`,
  );

  return {
    filesIndexed,
    filesSkipped,
    symbols: stats.symbols,
    edges,
    durationMs,
  };
}

/** If we skipped a file (hash match), load its existing symbols from the store for edge resolution. */
function hydrateFileMeta(
  store: GraphStore,
  relPath: string,
  fileMeta: Map<string, { fileId: number; symbolsByName: Map<string, number>; imports: ExtractedImport[]; symbols: ExtractedSymbol[] }>,
): void {
  const file = store.getFile(relPath);
  if (!file) return;
  // symbols: query all symbols in this file
  const symbols = store.raw
    .prepare(
      'SELECT id, name, kind, line_start, line_end FROM symbols WHERE file_id = ?',
    )
    .all(file.id) as Array<{ id: number; name: string; kind: string; line_start: number; line_end: number }>;
  const symbolsByName = new Map<string, number>();
  for (const s of symbols) symbolsByName.set(s.name, s.id);
  // imports: re-parse to get import specifiers (cheap relative to DB; we don't store imports)
  const absPath = resolve(relPath);
  let imports: ExtractedImport[] = [];
  if (existsSync(absPath)) {
    const src = safeRead(absPath);
    if (src) {
      const plugin = pluginForFile(relPath);
      if (plugin) {
        try {
          imports = extractSymbols(src, plugin, relPath).imports;
        } catch {
          imports = [];
        }
      }
    }
  }
  fileMeta.set(relPath, { fileId: file.id, symbolsByName, imports, symbols: [] });
}

/** Walk the project tree, returning absolute paths of supported files, respecting ignores. */
export function collectSupportedFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (IGNORED_DIRS.has(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (name.startsWith('.') && name !== '.') continue; // hidden dirs
        walk(full);
      } else if (st.isFile()) {
        if (IGNORED_SUFFIXES.some((sfx) => name.endsWith(sfx))) continue;
        if (pluginForFile(toPosix(relative(root, full)))) {
          out.push(full);
        }
      }
    }
  };
  walk(root);
  return out;
}

function safeRead(absPath: string): string | null {
  try {
    return readFileSync(absPath, 'utf-8');
  } catch {
    return null;
  }
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
