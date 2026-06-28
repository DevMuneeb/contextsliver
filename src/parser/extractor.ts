// Symbol + import extractor.
//
// Given source code and a language plugin, run the tags.scm query and turn the matches into
// structured ParseResult { symbols, imports }. This is pure (no DB, no fs) so it's trivially
// testable with golden files.
//
// Key responsibilities:
//   - pair each @definition.* capture with its sibling @name capture in the same match
//   - compute a condensed signature (first line of the declaration, no body)
//   - for TS `const x = ...` (captured as variable), reclassify as a function if the value is
//     an arrow function or function expression
//   - read class heritage clauses (extends/implements) directly off the class node — more robust
//     than encoding them as nested optional query patterns
//   - parse import nodes to extract the source specifier + imported names
import Parser, { Query } from 'tree-sitter';
import type { LanguagePlugin } from './languages/registry.js';
import { typescriptGrammarForFile } from './languages/typescript.js';
import type {
  ExtractedSymbol,
  ExtractedImport,
  ParseResult,
} from './types.js';
import type { SymbolKind } from '../graph/types.js';

// One cached Query per plugin (Query construction is a bit expensive and the query is static).
const queryCache = new WeakMap<LanguagePlugin, Query>();
// Parser instances are reusable; we keep one per plugin to amortize setup. Indexing is
// synchronous per file so reusing a parser is safe.
const parserCache = new WeakMap<LanguagePlugin, Parser>();

/** Build (or fetch) a cached Query for a plugin's default grammar. */
export function getQuery(plugin: LanguagePlugin): Query {
  let q = queryCache.get(plugin);
  if (!q) {
    // Query throws on a malformed/invalid query string. We surface that as a clear error.
    try {
      q = new Query(plugin.language, plugin.query);
    } catch (err) {
      throw new Error(
        `Invalid tree-sitter query for '${plugin.id}': ${(err as Error).message}`,
      );
    }
    queryCache.set(plugin, q);
  }
  return q;
}

/** Build (or fetch) a cached Parser for a plugin. */
export function getParser(plugin: LanguagePlugin): Parser {
  let p = parserCache.get(plugin);
  if (!p) {
    p = new Parser();
    p.setLanguage(plugin.language);
    parserCache.set(plugin, p);
  }
  return p;
}

/**
 * Extract symbols + imports from source code.
 *
 * @param source  - raw file text
 * @param plugin  - the language plugin (provides grammar + query)
 * @param filePath - used only to pick tsx vs ts grammar for the TS family
 */
export function extractSymbols(
  source: string,
  plugin: LanguagePlugin,
  filePath?: string,
): ParseResult {
  // For TS, pick the right grammar (tsx vs ts) and parse with a parser set to it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let language: any = plugin.language;
  const parser = new Parser();
  if (plugin.id === 'typescript' && filePath) {
    const grammar = typescriptGrammarForFile(filePath);
    if (grammar) {
      language = grammar;
      parser.setLanguage(grammar as never);
    } else {
      parser.setLanguage(plugin.language as never);
    }
  } else {
    parser.setLanguage(plugin.language as never);
  }

  const tree = parser.parse(source);
  if (!tree) return { symbols: [], imports: [] };

  // Use a query compiled against THIS grammar (tsx vs ts have different node schemas).
  let query: Query;
  try {
    query = new Query(language, plugin.query);
  } catch (err) {
    throw new Error(
      `Invalid tree-sitter query for '${plugin.id}': ${(err as Error).message}`,
    );
  }

  const matches = query.matches(tree.rootNode);

  const symbols: ExtractedSymbol[] = [];
  const imports: ExtractedImport[] = [];
  const seenSymbolKeys = new Set<string>(); // dedupe (some patterns overlap)

  for (const match of matches) {
    // Bucket captures by name within this match.
    let defKind: string | null = null;
    let defNode: Parser.SyntaxNode | null = null;
    let nameNode: Parser.SyntaxNode | null = null;
    let isImport = false;

    for (const cap of match.captures) {
      if (cap.name === 'import') {
        isImport = true;
        // don't break — there may be no other captures
      } else if (cap.name.startsWith('definition.')) {
        defKind = cap.name.replace('definition.', '');
        defNode = cap.node;
      } else if (cap.name === 'name') {
        nameNode = cap.node;
      }
    }

    if (isImport) {
      const imp = parseImportNode(match.captures[0].node, plugin.id);
      if (imp) imports.push(imp);
      continue;
    }

    if (!defKind || !defNode || !nameNode) continue;
    const name = nameNode.text;
    if (!name) continue;

    let kind = defKind as SymbolKind;
    // Reclassify TS `const x = () => ...` (captured as variable) as a function.
    // The captured node may be the lexical_declaration (parent) or the variable_declarator;
    // find the declarator either way, then inspect its value.
    if (kind === 'variable' && plugin.id === 'typescript' && defNode) {
      const declarator =
        defNode.type === 'variable_declarator'
          ? defNode
          : defNode.childForFieldName('declaration') ?? // export_statement
            (defNode.namedChildren.find((c) => c.type === 'variable_declarator') ?? null);
      const valueNode = declarator?.childForFieldName('value') ?? null;
      if (valueNode && isFunctionValueNode(valueNode)) {
        kind = 'function';
      }
    }

    const key = `${kind}:${name}:${defNode.startPosition.row}`;
    if (seenSymbolKeys.has(key)) continue;
    seenSymbolKeys.add(key);

    const symbol: ExtractedSymbol = {
      name,
      kind,
      line_start: defNode.startPosition.row + 1, // tree-sitter rows are 0-based
      line_end: defNode.endPosition.row + 1,
      signature: signatureFor(defNode),
    };

    // Class inheritance: read heritage clauses directly off the class node (TS).
    if (kind === 'class' && plugin.id === 'typescript') {
      const heritage = readTsClassHeritage(defNode);
      if (heritage.extends.length) symbol.extends = heritage.extends;
      if (heritage.implements.length) symbol.implements = heritage.implements;
    }
    // Python class bases live in the argument_list; the query already captured @extends names.
    if (kind === 'class' && plugin.id === 'python') {
      const ext = match.captures
        .filter((c) => c.name === 'extends')
        .map((c) => c.node.text)
        .filter((t) => t && !['object'].includes(t)); // drop implicit `object`
      if (ext.length) symbol.extends = ext;
    }

    symbols.push(symbol);
  }

  return { symbols, imports };
}

/** Is a TS variable's value a function-shaped node (arrow or function expression)? */
function isFunctionValueNode(node: Parser.SyntaxNode): boolean {
  return node.type === 'arrow_function' || node.type === 'function_expression';
}

/**
 * Build a condensed signature: the first line of the declaration, with the body elided.
 * e.g. "export function login(u: string): Token {" → "function login(u: string): Token"
 */
function signatureFor(node: Parser.SyntaxNode): string {
  // For a variable_declarator captured as variable/function, the parent lexical_declaration
  // holds the `export`/`const` prefix. Use the declarator text for the signature.
  let text: string;
  if (node.type === 'variable_declarator') {
    // Include the leading const/let/export by walking to the parent statement if present.
    const parent = node.parent;
    if (parent && (parent.type === 'lexical_declaration' || parent.type === 'export_statement')) {
      const kw = parent.type === 'export_statement' ? 'export ' : '';
      const decl = parent.type === 'export_statement' ? parent.childForFieldName('declaration') : parent;
      const prefix = decl && decl.type === 'lexical_declaration' ? firstToken(decl) : 'const';
      text = `${kw}${prefix} ${node.text}`;
    } else {
      text = node.text;
    }
  } else {
    text = node.text;
  }

  // Take the first line and trim the trailing { or ; and surrounding whitespace.
  const firstLine = text.split('\n')[0] ?? text;
  return firstLine.replace(/[{;]\s*$/, '').trim();
}

function firstToken(decl: Parser.SyntaxNode): string {
  const child = decl.firstChild;
  return child ? child.text : 'const';
}

/**
 * Read extends/implements heritage clause names from a TS class_declaration node.
 * The grammar puts these under class_heritage → extends_clause / implements_clause.
 */
function readTsClassHeritage(classNode: Parser.SyntaxNode): {
  extends: string[];
  implements: string[];
} {
  const result = { extends: [] as string[], implements: [] as string[] };
  // Walk immediate + heritage children for clause nodes.
  const walk = (n: Parser.SyntaxNode) => {
    for (const child of n.namedChildren ?? []) {
      if (child.type === 'extends_clause') {
        const value = child.childForFieldName('value');
        if (value) result.extends.push(value.text.split('<')[0]); // strip generic args
      } else if (child.type === 'implements_clause') {
        for (const t of child.namedChildren) {
          if (t.type === 'type_identifier' || t.type === 'generic_type') {
            result.implements.push(t.text.split('<')[0]);
          }
        }
      }
      if (child.namedChildren?.length) walk(child);
    }
  };
  walk(classNode);
  return result;
}

/**
 * Parse an import node into { specifier, names }. Handles the common shapes for TS and Python.
 */
function parseImportNode(
  node: Parser.SyntaxNode,
  language: string,
): ExtractedImport | null {
  const text = node.text;
  if (language === 'typescript') {
    return parseTsImport(node, text);
  }
  if (language === 'python') {
    return parsePythonImport(node, text);
  }
  return { specifier: text, names: [] };
}

/** TS imports: extract the source string and the imported binding names. */
function parseTsImport(
  node: Parser.SyntaxNode,
  text: string,
): ExtractedImport {
  // Source: the string literal (last child of the import statement, typically).
  const sourceClause = node.childForFieldName('source');
  const specifier = sourceClause
    ? sourceClause.text.replace(/^["']|["']$/g, '')
    : extractStringLiteral(text);

  const names: string[] = [];
  // named imports: import { A, B as C } from "..."
  const namedFields = node.descendantsOfType('import_clause');
  for (const clause of namedFields) {
    for (const spec of clause.descendantsOfType('import_specifier')) {
      const nameNode = spec.childForFieldName('name');
      if (nameNode) names.push(nameNode.text);
    }
    // default import: import DefaultName from "..."
    const idents = clause.namedChildren.filter((c) => c.type === 'identifier');
    for (const id of idents) {
      if (!names.includes(id.text)) names.push(id.text);
    }
    // namespace import: import * as Ns from "..."
    const ns = clause.descendantsOfType('namespace_import');
    for (const n of ns) {
      // namespace_import node's sibling identifier holds the name
      const id = n.nextNamedSibling;
      if (id) names.push(id.text);
    }
  }

  return { specifier, names };
}

/** Python imports: `import a.b as c` or `from m import x, y as z`. */
function parsePythonImport(
  node: Parser.SyntaxNode,
  text: string,
): ExtractedImport {
  // from_statement has module: ... and names: ...
  if (node.type === 'import_from_statement') {
    const moduleNode = node.childForFieldName('module');
    const specifier = moduleNode ? moduleNode.text : '';
    const names: string[] = [];
    const dotted = node.descendantsOfType('dotted_name');
    for (const d of dotted) {
      // the last segment is the imported binding name for `from m import x`
      const segs = d.text.split('.');
      const last = segs[segs.length - 1];
      if (last && !names.includes(last)) names.push(last);
    }
    return { specifier, names };
  }
  // plain import: `import a.b.c` → specifier a.b.c, names [a] (the binding)
  const dotted = node.descendantsOfType('dotted_name');
  if (dotted.length) {
    const specifier = dotted[0].text;
    const last = specifier.split('.')[0]; // `import a.b` binds `a`
    return { specifier, names: [last] };
  }
  return { specifier: text, names: [] };
}

/** Last resort: pull a quoted string out of raw import text. */
function extractStringLiteral(text: string): string {
  const m = text.match(/from\s+(['"])(.*?)\1/) || text.match(/import\s+(['"])(.*?)\1/);
  return m ? m[2] : '';
}
