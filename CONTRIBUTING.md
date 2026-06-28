# Contributing to ContextSliver

Contributions welcome — especially **new language plugins**. This guide focuses on that.

## Adding a language

ContextSliver's parser is a plugin registry: each language is a grammar + a Tree-sitter query
(`tags.scm`) + a fixture. To add one:

### 1. Install the grammar

```bash
npm install tree-sitter-<language>
```

These are native Node (NAPI) packages with prebuilt binaries — no compile step on most platforms.

### 2. Add the query file

Create `grammars/<language>/tags.scm`. This Tree-sitter query tells ContextSliver which nodes are
symbols (and what kind), imports, and inheritance edges. Use the existing files as a template:

- [`grammars/typescript/tags.scm`](./grammars/typescript/tags.scm)
- [`grammars/python/tags.scm`](./grammars/python/tags.scm)

Capture names follow a convention so the extractor knows how to interpret each match:

| Capture | Meaning |
|---------|---------|
| `@definition.function` | a function/method declaration (node text in capture = the whole decl) |
| `@definition.class` | a class declaration |
| `@definition.interface` | an interface / protocol / trait |
| `@definition.type` | a type alias |
| `@definition.variable` | a top-level variable / constant |
| `@name` | the **name** identifier paired with a `@definition.*` capture |
| `@import` | an import statement (extract the imported names) |
| `@extends` | a base-class / inherited name |
| `@implements` | an implemented-interface name |

> The query file is the single source of truth. It's loaded at runtime by the language plugin, so
> you can iterate on extraction without recompiling.

### 3. Register the plugin

Add a file `src/parser/languages/<language>.ts`:

```typescript
import type { LanguagePlugin } from './registry.js';
import { loadQuery } from './registry.js';
// Load the grammar (check the package's export shape — see notes below)
import Lang from 'tree-sitter-<language>';

export const myLanguage: LanguagePlugin = {
  name: 'mylang',
  extensions: ['.ml'],
  language: Lang,            // the tree-sitter Language object
  query: loadQuery('mylang'), // loads grammars/mylang/tags.scm at runtime
};
```

Then import it in `src/parser/languages/registry.ts` so it joins the extension map.

> **Grammar export shape**: some packages default-export the `Language` directly; some (e.g.
> `tree-sitter-typescript`) export `{ typescript, tsx }`. Check the package and adapt. The registry
> only needs the final `Language` object under `.language`.

### 4. Add a fixture + golden test

- `fixtures/<language>/simple.<ext>` — a small source file exercising the main constructs.
- `fixtures/<language>/expected/simple.json` — the exact symbols the extractor must produce.

Then add a `describe('<language> parser')` block to [`test/unit/parser.test.ts`](./test/unit/parser.test.ts)
that asserts `extractSymbols(source, '<language>').symbols` equals the golden file. This is how we
catch regressions when grammar versions change.

## Development setup

```bash
git clone https://github.com/DevMuneeb/contextsliver.git
cd contextsliver
npm install      # installs native deps (better-sqlite3, tree-sitter) — may take a minute
npm test
```

Requires Node ≥ 20.

## The one rule that matters most

**Never use `console.log` in `src/`.** stdout is the MCP protocol channel — any stray output there
corrupts JSON-RPC and silently disconnects the client (the agent just stops working, with no error).
We enforce this with an eslint `no-console` rule and the
[`stdout-purity` integration test](./test/integration/stdout-purity.test.ts). Use the
[`log()` helper](./src/utils/logger.ts), which writes to stderr.

## Commit style

- Small, focused commits.
- Run `npm run lint && npm test` before pushing.
- Reference the relevant roadmap item from [`contextsliver-spec.md`](./contextsliver-spec.md).

## License

By contributing you agree your changes are licensed MIT, same as the rest of the project.
