import path from 'node:path';
import { defineConfig } from 'vitest/config';

export const sharedConfig = defineConfig({
  test: {
    include: ['**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
    },
    env: {
      // biome-ignore lint/style/useNamingConvention:
      FIRESTORE_EMULATOR_HOST: 'localhost:60001',
      // biome-ignore lint/style/useNamingConvention:
      TEST_PROJECT: 'ikenox-sunrise',
      // biome-ignore lint/style/useNamingConvention:
      TEST_DB: 'test-db',
    },
    alias: {
      'firestore-repository': path.join(import.meta.dirname, 'packages/firestore-repository/src'),
    },
  },
});
