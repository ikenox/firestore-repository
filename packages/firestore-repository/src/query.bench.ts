import { bench, describe } from 'vitest';

import { authorsCollection, postsCollection } from './__test__/specification.js';
import { and, eq, gt, limit, or, orderBy, query, where } from './query.js';

describe('query', () => {
  bench('simple collection query', () => {
    query({ collection: authorsCollection });
  });

  bench('query with where and limit', () => {
    query({ collection: authorsCollection }, where(eq('rank', 1)), limit(10));
  });

  bench('query with complex and filter', () => {
    query(
      { collection: authorsCollection },
      where(and(gt('rank', 0), eq('name', 'test'))),
      orderBy('rank'),
      limit(10),
    );
  });

  bench('query with or filter', () => {
    query(
      { collection: authorsCollection },
      where(or(eq('rank', 1), eq('rank', 2))),
    );
  });

  bench('collection group query', () => {
    query({ collection: postsCollection, group: true }, orderBy('postedAt'), limit(10));
  });

  bench('subcollection query', () => {
    query(
      { collection: postsCollection, parent: ['author1'] as [string] },
      orderBy('postedAt'),
    );
  });
});
