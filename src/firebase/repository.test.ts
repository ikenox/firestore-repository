import { initializeApp } from '@firebase/app';
import { Timestamp, connectFirestoreEmulator, getFirestore } from '@firebase/firestore';
import { describe } from 'vitest';
import { defineRepositorySpecificationTests } from '../__test__/specification.js';
import { Repository } from './repository.js';

describe('repository', async () => {
  const db = getFirestore(
    // biome-ignore lint/style/noNonNullAssertion: <explanation>
    initializeApp({ projectId: process.env['TEST_PROJECT']! }),
    // biome-ignore lint/style/noNonNullAssertion: <explanation>
    process.env['TEST_DB']!,
  );
  // biome-ignore lint/style/noNonNullAssertion: <explanation>
  const [host, port] = process.env['FIRESTORE_EMULATOR_HOST']!.split(':');
  // biome-ignore lint/style/noNonNullAssertion: <explanation>
  connectFirestoreEmulator(db, host!, Number(port));

  defineRepositorySpecificationTests((collection) => new Repository(collection, db), {
    converters: {
      timestamp: (date) => Timestamp.fromDate(date),
    },
  });
});
