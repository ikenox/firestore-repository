import path from 'path';
import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    alias: {
      'firestore-repository': path.join(import.meta.dirname, '../firestore-repository/src'),
    },
  },
});
