import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
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
