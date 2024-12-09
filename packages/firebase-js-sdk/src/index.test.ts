import { initializeApp } from '@firebase/app';
import { connectFirestoreEmulator, getFirestore } from '@firebase/firestore';
import { defineRepositorySpecificationTests } from 'firestore-repository/__test__/specification';
import { describe } from 'vitest';
import { type Env, Repository } from './index.js';

describe('repository', async () => {
  const db = getFirestore(
    initializeApp({ projectId: process.env['TEST_PROJECT']! }),
    process.env['TEST_DB']!,
  );
  const [host, port] = process.env['FIRESTORE_EMULATOR_HOST']!.split(':');
  connectFirestoreEmulator(db, host!, Number(port));

  defineRepositorySpecificationTests<Env>((collection) => new Repository(collection, db), {});
});
