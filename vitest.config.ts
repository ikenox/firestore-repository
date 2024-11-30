import path from 'node:path';
import { defineConfig } from 'vitest/config';

// biome-ignore lint/style/noDefaultExport:
export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    isolate: false,
    coverage: {
      provider: 'v8',
      reporter: ['text'],
    },
    alias: {
      'firestore-repository': path.join(import.meta.dirname, 'packages/firestore-repository/src'),
    },
  },
});
