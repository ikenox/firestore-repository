import { initializeApp } from '@firebase/app';
import {
  connectFirestoreEmulator,
  getFirestore,
  runTransaction,
  writeBatch,
} from '@firebase/firestore';
import { defineRepositorySpecificationTests } from 'firestore-repository/__test__/specification';
import { plainMapper } from 'firestore-repository/repository';
import { describe } from 'vitest';

import { createPlatformValueSerializer, type Env, repositoryWithMapper } from './index.js';

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
    serializer: createPlatformValueSerializer(db),
  });
});
