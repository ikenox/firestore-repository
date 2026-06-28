import { initializeApp } from '@firebase/app';
import {
  connectFirestoreEmulator,
  getFirestore,
  runTransaction,
  writeBatch,
} from '@firebase/firestore';
import { constant, equal, execute, field, mapSet } from '@firebase/firestore/pipelines';
import {
  authorsCollection,
  defineRepositorySpecificationTests,
} from 'firestore-repository/__test__/specification';
import { collection } from 'firestore-repository/pipelines/source';
import { plainMapper } from 'firestore-repository/repository';
import { describe, it } from 'vitest';

import { type Env, repositoryWithMapper } from './index.js';

describe('repository', async () => {
  const db = getFirestore(
    initializeApp({ projectId: process.env['FIRESTORE_TEST_PROJECT']! }),
    process.env['FIRESTORE_TEST_DB']!,
  );

  const emulatorHost = process.env['FIRESTORE_EMULATOR_HOST'];
  if (emulatorHost) {
    const [host, port] = emulatorHost.split(':');
    connectFirestoreEmulator(db, host!, Number(port));
  }

  const createRepository: Parameters<
    typeof defineRepositorySpecificationTests<Env>
  >[0]['createRepository'] = (collection) =>
    repositoryWithMapper(db, collection, plainMapper(collection));
  const dbOps: Parameters<typeof defineRepositorySpecificationTests<Env>>[0]['db'] = {
    writeBatch: () => writeBatch(db),
    transaction: (runner) => runTransaction(db, runner),
  };

  defineRepositorySpecificationTests<Env>({
    createRepository,
    createRepositoryWithMapper: (collection, mapper) =>
      repositoryWithMapper(db, collection, mapper),
    db: dbOps,
  });

  it('tmp: pipeline', () => {
    execute(
      db
        .pipeline()
        .collection('a')
        .where(constant('a').asBoolean())
        .select(constant('a').asBoolean().toUpper().as('hoge'))
        .sort(constant('a').ascending())
        .limit(1)
        .offset(2)
        .unnest(selectable)
        .search(options)
        .aggregate(accumulator)
        .distinct(group)
        .replaceWith(fieldName)
        .removeFields(fieldValue),
    );
  });

  collection(authorsCollection).select(() => ['']);
});
