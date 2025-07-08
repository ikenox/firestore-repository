import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      exclude: [
        '**/vitest.*.ts',
        '**/*.local.test.ts',
        '**/*.test.ts',
        '**/build/*',
        'examples/**',
      ],
    },
    env: {
      FIRESTORE_EMULATOR_HOST: 'localhost:60001',
      TEST_PROJECT: 'firestore-repository-dummy-project',
      TEST_DB: 'firestore-repository-test-db',
    },
  },
});
