// Fixture generator for indexing benchmarks.
//
// Creates a synthetic TypeScript project of N files, each exporting a class + function with a
// few cross-file imports, so the benchmark exercises parse + edge resolution realistically
// (not just empty files).
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface GenerateOptions {
  /** number of .ts files to generate */
  files: number;
  /** language (only 'typescript' supported for the generator; python is trivial to add) */
  language?: 'typescript';
}

/**
 * Generate a temp project of N TypeScript files. Returns the project root path.
 * Caller is responsible for cleanup (or call cleanupFixture).
 */
export function generateFixture(opts: GenerateOptions): string {
  const dir = mkdtempSync(join(tmpdir(), 'sliver-bench-'));
  const srcDir = join(dir, 'src');
  mkdirSync(srcDir, { recursive: true });

  const count = opts.files;
  for (let i = 0; i < count; i++) {
    // Import from a previous file (when present) to create edges to resolve.
    const importBlock =
      i > 0
        ? `import { Mod${i - 1} } from './mod${i - 1}';\n`
        : '';
    const body = `${importBlock}export class Mod${i} {
  private dep: ${i > 0 ? `Mod${i - 1}` : 'unknown'};
  doWork(x: number): number { return x * ${i + 1}; }
}

export function helper${i}(v: string): string { return v + '${i}'; }
`;
    writeFileSync(join(srcDir, `mod${i}.ts`), body);
  }
  return dir;
}

/** Remove a generated fixture directory. */
export function cleanupFixture(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
