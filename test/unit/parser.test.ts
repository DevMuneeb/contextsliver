// Parser golden-file tests. Mirrors contextsliver-spec.md §9.1.
//
// The golden files in fixtures/*/expected/*.json are the authoritative extractor output; if
// extraction intentionally changes, regenerate them (see CONTRIBUTING.md). A diff here means a
// regression — usually a tree-sitter grammar upgrade shifted node names.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractSymbols } from '../../src/parser/extractor.js';
import { typescriptPlugin } from '../../src/parser/languages/typescript.js';
import { pythonPlugin } from '../../src/parser/languages/python.js';

function golden(path: string): { symbols: unknown[]; imports: unknown[] } {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

describe('TypeScript parser', () => {
  it('extracts class and method symbols matching the golden file', () => {
    const source = readFileSync('fixtures/typescript/simple.ts', 'utf-8');
    const expected = golden('fixtures/typescript/expected/simple.json');
    const result = extractSymbols(source, typescriptPlugin, 'simple.ts');
    // Normalize order for stable comparison
    result.symbols.sort(
      (a, b) => a.line_start - b.line_start || a.name.localeCompare(b.name),
    );
    expect(result.symbols).toEqual(expected.symbols);
    expect(result.imports).toEqual(expected.imports);
  });

  it('detects all expected symbols (interface, class, functions, variable, type)', () => {
    const source = readFileSync('fixtures/typescript/simple.ts', 'utf-8');
    const result = extractSymbols(source, typescriptPlugin, 'simple.ts');
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain('AuthConfig');
    expect(names).toContain('AuthService');
    expect(names).toContain('login');
    expect(names).toContain('logout');
    expect(names).toContain('createAuthService');
    expect(names).toContain('DEFAULT_TIMEOUT');
    expect(names).toContain('Token');
  });

  it('classifies exported arrow functions as functions, not variables', () => {
    const source = readFileSync('fixtures/typescript/simple.ts', 'utf-8');
    const result = extractSymbols(source, typescriptPlugin, 'simple.ts');
    const handler = result.symbols.find((s) => s.name === 'handler');
    expect(handler).toBeDefined();
    expect(handler!.kind).toBe('function');
    const timeout = result.symbols.find((s) => s.name === 'DEFAULT_TIMEOUT');
    expect(timeout!.kind).toBe('variable');
  });

  it('correctly identifies import edges', () => {
    const source = readFileSync('fixtures/typescript/simple.ts', 'utf-8');
    const result = extractSymbols(source, typescriptPlugin, 'simple.ts');
    expect(result.imports.length).toBeGreaterThanOrEqual(2);
    expect(result.imports.some((e) => e.specifier.includes('User'))).toBe(true);
    expect(result.imports.some((e) => e.specifier.includes('TokenService'))).toBe(true);
  });

  it('captures class extends/implements heritage clauses', () => {
    const source = `class Dog extends Animal implements IWalker {
  bark() {}
}`;
    const result = extractSymbols(source, typescriptPlugin, 'd.ts');
    const dog = result.symbols.find((s) => s.name === 'Dog');
    expect(dog).toBeDefined();
    expect(dog!.extends).toContain('Animal');
    expect(dog!.implements).toContain('IWalker');
  });

  it('is deterministic — same source always gives same output', () => {
    const source = readFileSync('fixtures/typescript/simple.ts', 'utf-8');
    const r1 = extractSymbols(source, typescriptPlugin, 'simple.ts');
    const r2 = extractSymbols(source, typescriptPlugin, 'simple.ts');
    expect(r1).toEqual(r2);
  });

  it('handles the circular-import fixture without error', () => {
    const source = readFileSync('fixtures/typescript/circular.ts', 'utf-8');
    const expected = golden('fixtures/typescript/expected/circular.json');
    const result = extractSymbols(source, typescriptPlugin, 'circular.ts');
    result.symbols.sort(
      (a, b) => a.line_start - b.line_start || a.name.localeCompare(b.name),
    );
    expect(result.symbols).toEqual(expected.symbols);
  });

  it('returns empty results for source with no symbols', () => {
    const result = extractSymbols('// just a comment\n', typescriptPlugin, 'x.ts');
    expect(result.symbols).toHaveLength(0);
    expect(result.imports).toHaveLength(0);
  });
});

describe('Python parser', () => {
  it('extracts functions and classes matching the golden file', () => {
    const source = readFileSync('fixtures/python/simple.py', 'utf-8');
    const expected = golden('fixtures/python/expected/simple.json');
    const result = extractSymbols(source, pythonPlugin, 'simple.py');
    result.symbols.sort(
      (a, b) => a.line_start - b.line_start || a.name.localeCompare(b.name),
    );
    expect(result.symbols).toEqual(expected.symbols);
  });

  it('detects classes and methods', () => {
    const source = readFileSync('fixtures/python/simple.py', 'utf-8');
    const result = extractSymbols(source, pythonPlugin, 'simple.py');
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain('AuthService');
    expect(names).toContain('User');
    expect(names).toContain('login');
    expect(names).toContain('create_auth_service');
  });

  it('captures python class base classes for inheritance edges', () => {
    const source = 'class Dog(Animal):\n    def speak(self):\n        pass\n';
    const result = extractSymbols(source, pythonPlugin, 'd.py');
    const dog = result.symbols.find((s) => s.name === 'Dog');
    expect(dog).toBeDefined();
    expect(dog!.extends).toContain('Animal');
  });

  it('is deterministic', () => {
    const source = readFileSync('fixtures/python/simple.py', 'utf-8');
    const r1 = extractSymbols(source, pythonPlugin, 'simple.py');
    const r2 = extractSymbols(source, pythonPlugin, 'simple.py');
    expect(r1).toEqual(r2);
  });
});
