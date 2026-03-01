import { Firestore } from '@google-cloud/firestore';
import { authorsCollection } from 'firestore-repository/__test__/specification';
import { uniqueCollection } from 'firestore-repository/__test__/util';
import { eq, query, where } from 'firestore-repository/query';
import type { Doc } from 'firestore-repository/schema';
import { beforeAll, bench, describe } from 'vitest';

import { rootCollectionRepository } from './index.js';

describe('repository', () => {
  const db = new Firestore({
    projectId: process.env['FIRESTORE_TEST_PROJECT']!,
    databaseId: process.env['FIRESTORE_TEST_DB']!,
  });

  const collection = uniqueCollection(authorsCollection);
  const repository = rootCollectionRepository(db, collection);

  const docs = [
    { ref: ['1'], data: { name: 'author1', profile: { age: 20 }, rank: 1, tag: ['a', 'b'] } },
    { ref: ['2'], data: { name: 'author2', profile: { age: 30 }, rank: 2, tag: ['b', 'c'] } },
    { ref: ['3'], data: { name: 'author3', profile: { age: 40 }, rank: 1, tag: ['c', 'd'] } },
  ] as const satisfies Doc<typeof collection>[];

  beforeAll(async () => {
    await repository.batchSet(docs);
  });

  bench('get', async () => {
    await repository.get(docs[0].ref);
  });

  bench('set', async () => {
    await repository.set(docs[0]);
  });

  bench('list', async () => {
    await repository.list(query({ collection: repository.collection }));
  });

  bench('list with where', async () => {
    await repository.list(
      query({ collection: repository.collection }, where(eq('rank', 1))),
    );
  });

  bench('batchGet', async () => {
    await repository.batchGet([docs[0].ref, docs[1].ref, docs[2].ref]);
  });
});
