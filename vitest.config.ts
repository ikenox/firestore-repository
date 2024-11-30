import { defineConfig } from 'vitest/config';

// biome-ignore lint/style/noDefaultExport:
export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
    },
    env: {
      FIRESTORE_EMULATOR_HOST: 'localhost:60001',
      TEST_PROJECT: 'ikenox-sunrise',
      TEST_DB: 'test-db',
    },
  },
});
