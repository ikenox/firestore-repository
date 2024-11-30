import { Firestore, Timestamp } from '@google-cloud/firestore';
import { defineRepositorySpecificationTests } from 'firestore-repository/__test__/specification';
import { describe, expect, it } from 'vitest';
import { Repository, limit, orderBy, where } from './repository.js';

describe('repository', async () => {
  const db = new Firestore({
    projectId: process.env['TEST_PROJECT']!,
    databaseId: process.env['TEST_DB']!,
  });

  defineRepositorySpecificationTests((collection) => new Repository(collection, db), {
    converters: {
      timestamp: (date) => Timestamp.fromDate(date),
    },
    queryConstraints: {
      where,
      orderBy,
      limit,
    },
    implementationSpecificTests: ({ newData, notExistDocId }, setup) => {
      const { repository, items, expectDb } = setup();

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
});
