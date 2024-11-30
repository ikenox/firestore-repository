import { initializeApp } from '@firebase/app';
import { Timestamp, connectFirestoreEmulator, getFirestore } from '@firebase/firestore';
import { describe } from 'vitest';
import { defineRepositorySpecificationTests } from '../__test__/specification.js';
import { limit, orderBy, where } from './query.js';
import { Repository } from './repository.js';

describe('repository', async () => {
  const db = getFirestore(
    initializeApp({ projectId: process.env['TEST_PROJECT']! }),
    process.env['TEST_DB']!,
  );
  const [host, port] = process.env['FIRESTORE_EMULATOR_HOST']!.split(':');
  connectFirestoreEmulator(db, host!, Number(port));

  defineRepositorySpecificationTests((collection) => new Repository(collection, db), {
    converters: {
      timestamp: (date) => Timestamp.fromDate(date),
    },
    queryConstraints: { where, orderBy, limit },
  });
});
