import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts', '**/__test__/**/*.ts'],
    globalSetup: './src/__test__/setup.ts',
    isolate: false,
    pool: 'threads',
    coverage: {
      provider: 'v8',
      reporter: ['text'],
    },
  },
});
