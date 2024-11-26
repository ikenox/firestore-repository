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
    implementationSpecificTests: <Repository>({
      repository,
      newData,
    }: TestCollectionParams<any>) => {
      describe('create', () => {
        const data = newData();

        it('precondition', async () => {
          expect(await repository.get(data)).toBeUndefined();
        });
        it('success', async () => {
          await repository.create(data);
          const dataFromDb = await repository.get(data);
          expect(dataFromDb).toStrictEqual<typeof dataFromDb>(data);
        });
        it('already exists', async () => {
          await expect(repository.create(data)).rejects.toThrowError(/ALREADY_EXISTS/);
        });
      });
    },
  });
});
