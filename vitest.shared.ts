import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export const sharedConfig = defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['**/*.test.ts'],
    hookTimeout: 5000,
    testTimeout: 5000,
    env: {
      FIRESTORE_EMULATOR_HOST: 'localhost:60001',
      FIRESTORE_TEST_PROJECT: 'firestore-repository-dummy-project',
      FIRESTORE_TEST_DB: 'firestore-repository-test',
    },
  },
});
