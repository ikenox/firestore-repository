import { Firestore } from '@google-cloud/firestore';
import { authorsCollection } from 'firestore-repository/__test__/specification';
import { uniqueCollection } from 'firestore-repository/__test__/util';
import { eq, query, where } from 'firestore-repository/query';
import { plainMapper } from 'firestore-repository/repository';
import type { Doc } from 'firestore-repository/schema';
import { beforeAll, bench, describe } from 'vitest';

import { repositoryWithMapper } from './index.js';

describe('repository', () => {
  const db = new Firestore({
    projectId: process.env['FIRESTORE_TEST_PROJECT'] ?? '',
    databaseId: process.env['FIRESTORE_TEST_DB'] ?? '',
  });

  const collection = uniqueCollection(authorsCollection);
  const repository = repositoryWithMapper(db, collection, plainMapper(collection));

  const doc1: Doc<typeof collection> = {
    ref: ['1'],
    data: { name: 'author1', profile: { age: 20 }, rank: 1, tag: ['a', 'b'] },
  };
  const doc2: Doc<typeof collection> = {
    ref: ['2'],
    data: { name: 'author2', profile: { age: 30 }, rank: 2, tag: ['b', 'c'] },
  };
  const doc3: Doc<typeof collection> = {
    ref: ['3'],
    data: { name: 'author3', profile: { age: 40 }, rank: 1, tag: ['c', 'd'] },
  };

  beforeAll(async () => {
    await repository.batchSet([doc1, doc2, doc3]);
  });

  bench('get', async () => {
    await repository.get(doc1.ref);
  });

  bench('set', async () => {
    await repository.set(doc1);
  });

  bench('list', async () => {
    await repository.list(query({ collection: repository.collection }));
  });

  bench('list with where', async () => {
    await repository.list(query({ collection: repository.collection }, where(eq('rank', 1))));
  });

  bench('batchGet', async () => {
    await repository.batchGet([doc1.ref, doc2.ref, doc3.ref]);
  });
});
