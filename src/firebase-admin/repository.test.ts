import admin from 'firebase-admin';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { defineRepositorySpecificationTests } from '../__test__/specification.js';
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
    implementationSpecificTests: ({ newData, initial, notExistDocId }, setupRepository) => {
      let repository!: Repository;
      beforeEach(async () => {
        repository = await setupRepository();
      });

      describe('create', () => {
        const data = newData();

        it('success', async () => {
          await repository.create(data);
          const dataFromDb = await repository.get(data);
          expect(dataFromDb).toStrictEqual<typeof dataFromDb>(data);
        });

        it('already exists', async () => {
          await repository.create(data);
          await expect(repository.create(data)).rejects.toThrowError(/ALREADY_EXISTS/);
        });
      });

      describe('batchGet', () => {
        it('empty', async () => {
          expect(await repository.batchGet([])).toStrictEqual([]);
        });

        it('not empty', async () => {
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
