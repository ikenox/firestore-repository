import { FieldValue, Firestore, GeoPoint, Timestamp } from '@google-cloud/firestore';
import {
  authorsCollection,
  defineRepositorySpecificationTests,
} from 'firestore-repository/__test__/specification';
import { uniqueCollection } from 'firestore-repository/__test__/util';
import { query } from 'firestore-repository/query';
import type { PlainModel } from 'firestore-repository/repository';
import type { Doc } from 'firestore-repository/schema';
import { beforeAll, describe, expect, it } from 'vitest';
import { type Env, type GoogleCloudFirestoreRepository, newRepository } from './index.js';
import { offset } from './query.js';
import { wrap } from './value.js';

describe('repository', async () => {
  const db = new Firestore({
    projectId: process.env['FIRESTORE_TEST_PROJECT']!,
    databaseId: process.env['FIRESTORE_TEST_DB']!,
  });

  defineRepositorySpecificationTests<Env>({
    createRepository: (collection) => newRepository(db, collection),
    types: {
      timestamp: (date) => wrap(Timestamp.fromDate(date)),
      geoPoint: (latitude, longitude) => wrap(new GeoPoint(latitude, longitude)),
      bytes: (bytes) => wrap(Buffer.from(bytes)),
      vector: (value) => wrap(FieldValue.vector(value)),
      documentReference: (path) => wrap(db.doc(path)),
    },
    db: { writeBatch: () => db.batch(), transaction: (runner) => db.runTransaction(runner) },
    implementationSpecificTests: ({ newData, notExistDocId, collection }, setup) => {
      type TestCollection = typeof collection;

      const { repository: _repo, items, expectDb } = setup();
      // biome-ignore lint/plugin/no-type-assertion: cannot infer generic type
      const repository = _repo as GoogleCloudFirestoreRepository<
        TestCollection,
        PlainModel<TestCollection>
      >;

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
            await repository.batchGet([
              items[0].ref,
              items[2].ref,
              items[1].ref,
              notExistDocId(),
              items[2].ref,
            ]),
          ).toStrictEqual([items[0], items[2], items[1], undefined, items[2]]);
        });

        it('transaction', async () => {
          const res = await db.runTransaction(async (tx) => {
            return await repository.batchGet(
              [items[0].ref, items[2].ref, items[1].ref, notExistDocId(), items[2].ref],
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
    const coll = uniqueCollection(authorsCollection);
    const repository = newRepository(db, coll);
    const items = [
      {
        ref: ['1'],
        data: { name: 'author1', profile: { age: 20, gender: 'male' }, rank: 1, tag: ['a', 'b'] },
      },
      {
        ref: ['2'],
        data: { name: 'author2', profile: { age: 40, gender: 'female' }, rank: 1, tag: ['b', 'c'] },
      },
      { ref: ['3'], data: { name: 'author3', profile: { age: 60 }, rank: 2, tag: ['c', 'd'] } },
    ] as const satisfies Doc<typeof authorsCollection>[];

    beforeAll(async () => {
      await repository.batchSet(items);
    });

    it('offset', async () => {
      const [, ...rest] = items;
      const result = await repository.list(query({ collection: repository.collection }, offset(1)));
      expect(result).toStrictEqual(rest);
    });
  });
});
