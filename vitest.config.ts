import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/bench/**', 'node_modules/**', 'dist/**'],
    globals: false,
    testTimeout: 30000,
    // SQLite native binding + tree-sitter must load under Node ESM
    pool: 'forks',
  },
});
