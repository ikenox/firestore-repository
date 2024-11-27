import { defineConfig } from 'vitest/config';

// biome-ignore lint/style/noDefaultExport: <explanation>
export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    globalSetup: './src/__test__/setup.ts',
    isolate: false,
    pool: 'threads',
    coverage: {
      provider: 'v8',
      reporter: ['text'],
    },
  },
});
