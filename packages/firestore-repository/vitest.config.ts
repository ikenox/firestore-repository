import path from 'node:path';
import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    alias: {
      'firestore-repository': path.join(import.meta.dirname, 'packages/firestore-repository/src'),
    },
  },
});
