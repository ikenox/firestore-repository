import { FieldValue, Firestore, GeoPoint, Timestamp } from '@google-cloud/firestore';
import {
  authorsCollection,
  defineRepositorySpecificationTests,
} from 'firestore-repository/__test__/specification';
import { uniqueCollection } from 'firestore-repository/__test__/util';
import { query } from 'firestore-repository/query';
import type { Model } from 'firestore-repository/schema';
import { beforeAll, describe, expect, it } from 'vitest';
import { type Env, Repository, offset } from './index.js';

describe('repository', async () => {
  const db = new Firestore({
    projectId: process.env['TEST_PROJECT']!,
    databaseId: process.env['TEST_DB']!,
  });

  defineRepositorySpecificationTests<Env>({
    createRepository: (collection) => new Repository(collection, db),
    types: {
      timestamp: (date) => Timestamp.fromDate(date),
      geoPoint: (latitude, longitude) => new GeoPoint(latitude, longitude),
      bytes: (bytes) => Buffer.from(bytes),
      vector: (value) => FieldValue.vector(value),
      documentReference: (path) => db.doc(path),
    },
    db: {
      writeBatch: () => db.batch(),
      transaction: (runner) => db.runTransaction(runner),
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

        describe('transaction', () => {
          it('success', async () => {
            const newItem = newData();
            await db.runTransaction(async () => {
              await repository.create(newItem);
            });
            await expectDb([newItem, ...items]);
          });
          it('abort', async () => {
            const promise = db.runTransaction(async (tx) => {
              await repository.create(newData(), { tx });
              throw new Error('abort');
            });
            await expect(promise).rejects.toThrowError('abort');
            await expectDb(items);
          });
        });

        it('writeBatch', async () => {
          const newItem = newData();

          const batch = db.batch();
          await repository.set(newItem, { tx: batch });
          await expectDb(items);
          await batch.commit();
          await expectDb([newItem, ...items]);
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

        it('transaction', async () => {
          const res = await db.runTransaction(async (tx) => {
            return await repository.batchGet(
              [items[0], items[2], items[1], notExistDocId(), items[2]],
              { tx },
            );
          });
          expect(res).toStrictEqual([items[0], items[2], items[1], undefined, items[2]]);
        });
      });

      describe('batchCreate', () => {
        it('empty', async () => {
          await repository.batchCreate([]);
          await expectDb(items);
        });

        it('not empty', async () => {
          const newItems = [newData(), newData()];
          await repository.batchCreate(newItems);
          await expectDb([...items, ...newItems]);
        });

        it('already exists', async () => {
          const newItem = newData();
          await expect(repository.batchCreate([newItem, items[0]])).rejects.toThrowError(
            /ALREADY_EXISTS/,
          );
          await expectDb(items);
        });
      });
    },
  });

  describe('query', () => {
    const repository = new Repository(uniqueCollection(authorsCollection), db);
    const items = [
      {
        authorId: '1',
        name: 'author1',
        profile: { age: 20, gender: 'male' },
        rank: 1,
        registeredAt: new Date('2020-02-01'),
      },
      {
        authorId: '2',
        name: 'author2',
        profile: { age: 40, gender: 'female' },
        rank: 1,
        registeredAt: new Date('2020-01-01'),
      },
      {
        authorId: '3',
        name: 'author3',
        profile: { age: 60 },
        rank: 2,
        registeredAt: new Date('2020-03-01'),
      },
    ] as const satisfies Model<typeof authorsCollection>[];

    beforeAll(async () => {
      await repository.batchSet(items);
    });

    it('offset', async () => {
      const [, ...rest] = items;
      const result = await repository.list(query(repository.collection, offset(1)));
      expect(result).toStrictEqual(rest);
    });
  });
});
