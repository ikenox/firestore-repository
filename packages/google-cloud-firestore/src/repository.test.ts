import { Firestore } from '@google-cloud/firestore';
import type { Model } from 'firestore-repository';
import {
  authorsCollection,
  defineRepositorySpecificationTests,
} from 'firestore-repository/__test__/specification';
import { uniqueCollection } from 'firestore-repository/__test__/util';
import { beforeAll, describe, expect, it } from 'vitest';
import { Repository, limit, limitToLast, offset, orderBy, where } from './repository.js';

describe('repository', async () => {
  const db = new Firestore({
    projectId: process.env['TEST_PROJECT']!,
    databaseId: process.env['TEST_DB']!,
  });

  defineRepositorySpecificationTests((collection) => new Repository(collection, db), {
    queryConstraints: {
      where,
      orderBy,
      limit,
      limitToLast,
    },
    implementationSpecificTests: ({ newData, notExistDocId, collection }, setup) => {
      type Collection = typeof collection;

      const { repository: _repo, items, expectDb } = setup();
      const repository = _repo as Repository<Collection>;

      describe('create', () => {
        it('success', async () => {
          const newItem = newData();
          await repository.create(newItem);
          await expectDb([newItem, ...items]);
        });

        it('already exists', async () => {
          const newItem = newData();
          await repository.create(newItem);
          await expect(repository.create(newItem)).rejects.toThrowError(/ALREADY_EXISTS/);
        });
      });

      describe('batchGet', () => {
        it('empty', async () => {
          expect(await repository.batchGet([])).toStrictEqual([]);
        });

        it('not empty', async () => {
          expect(
            await repository.batchGet([items[0], items[2], items[1], notExistDocId(), items[2]]),
          ).toStrictEqual([items[0], items[2], items[1], undefined, items[2]]);
        });
      });
    },
  });

  describe('query', () => {
    const repository = new Repository(uniqueCollection(authorsCollection), db);
    const items = [
      { authorId: '1', name: 'author1', age: 20, registeredAt: new Date('2020-02-01') },
      { authorId: '2', name: 'author2', age: 40, registeredAt: new Date('2020-01-01') },
      { authorId: '3', name: 'author3', age: 60, registeredAt: new Date('2020-03-01') },
    ] as const satisfies Model<typeof authorsCollection>[];

    beforeAll(async () => {
      await repository.batchSet(items);
    });

    it('offset', async () => {
      const [first, ...rest] = items;
      const result = await repository.list(repository.query({}, offset(1)));
      expect(result).toStrictEqual(rest);
    });
  });
});
