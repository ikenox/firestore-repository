import { defineConfig } from 'vitest/config';

export const sharedConfig = defineConfig({
  resolve: { conditions: ['@firestore-repository/source'] },
  environments: { ssr: { resolve: { conditions: ['@firestore-repository/source'] } } },
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
