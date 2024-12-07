import path from 'node:path';
import { defineConfig } from 'vitest/config';

export const sharedConfig = defineConfig({
  test: {
    include: ['**/*.test.ts'],
    alias: {
      'firestore-repository': path.join(import.meta.dirname, 'packages/firestore-repository/src'),
    },
  },
});
