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
  },
});
