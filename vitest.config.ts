import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      FIRESTORE_EMULATOR_HOST: 'localhost:60001',
    },
  },
});
