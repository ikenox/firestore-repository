import admin from 'firebase-admin';
import { Timestamp as AdminTimestamp, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  TestCollectionParams,
  defineRepositorySpecificationTests,
} from '../__test__/specification.js';
import { Repository } from './repository.js';

describe('repository', async () => {
  const db = getFirestore(
    admin.initializeApp({ projectId: process.env['TEST_PROJECT']! }),
    process.env['TEST_DB']!,
  );

  defineRepositorySpecificationTests((collection) => new Repository(collection, db), {
    converters: {
      timestamp: (date) => Timestamp.fromDate(date),
    },
    implementationSpecificTests: ({ newData, initial, notExistDocId }, testWithDb) => {
      describe('create', () => {
        const data = newData();

        testWithDb('success', async ({ repository }) => {
          await repository.create(data);
          const dataFromDb = await repository.get(data);
          expect(dataFromDb).toStrictEqual<typeof dataFromDb>(data);
        });

        testWithDb('already exists', async ({ repository }) => {
          await repository.create(data);
          await expect(repository.create(data)).rejects.toThrowError(/ALREADY_EXISTS/);
        });
      });

      describe('batchGet', () => {
        testWithDb('empty', async ({ repository }) => {
          expect(await repository.batchGet([])).toStrictEqual([]);
        });

        testWithDb('not empty', async ({ repository }) => {
          const dataList = initial;
          expect(
            await repository.batchGet([
              dataList[0],
              dataList[2],
              dataList[1],
              notExistDocId(),
              dataList[2],
            ]),
          ).toStrictEqual([dataList[0], dataList[2], dataList[1], undefined, dataList[2]]);
        });
      });
    },
  });
});
