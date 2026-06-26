import { defineConfig } from 'vitest/config';

// Unit tests target the pure engine only. Edge functions are Deno-runtime and
// are excluded from the Node/vitest run.
export default defineConfig({
  test: {
    include: ['engine/**/*.test.ts', 'services/**/*.test.ts'],
    environment: 'node',
  },
});
