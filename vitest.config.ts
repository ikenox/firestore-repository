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
      // biome-ignore lint/style/useNamingConvention:
      FIRESTORE_EMULATOR_HOST: 'localhost:60001',
      // biome-ignore lint/style/useNamingConvention:
      TEST_PROJECT: 'ikenox-sunrise',
      // biome-ignore lint/style/useNamingConvention:
      TEST_DB: 'test-db',
    },
  },
});
