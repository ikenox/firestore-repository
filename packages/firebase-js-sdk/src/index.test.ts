import { initializeApp } from '@firebase/app';
import {
  connectFirestoreEmulator,
  getFirestore,
  runTransaction,
  writeBatch,
} from '@firebase/firestore';
import { defineRepositorySpecificationTests } from 'firestore-repository/__test__/specification';
import { describe } from 'vitest';
import { type Env, Repository } from './index.js';

describe('repository', async () => {
  const db = getFirestore(
    initializeApp({ projectId: process.env['TEST_PROJECT']! }),
    process.env['TEST_DB']!,
  );

  const emulatorHost = process.env['FIRESTORE_EMULATOR_HOST'];
  if (emulatorHost) {
    const [host, port] = emulatorHost.split(':');
    connectFirestoreEmulator(db, host!, Number(port));
  }

  defineRepositorySpecificationTests<Env>({
    createRepository: (collection) => new Repository(collection, db),
    db: {
      writeBatch: () => writeBatch(db),
      transaction: (runner) => runTransaction(db, runner),
    },
  });
});
