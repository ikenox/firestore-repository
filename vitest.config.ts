import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './src/__test__/globalSetup.ts',
  },
});
