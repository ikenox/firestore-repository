import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export const sharedConfig = defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['**/*.test.ts'],
    hookTimeout: 5000,
    testTimeout: 5000,
  },
});
