import { initializeApp } from '@firebase/app';
import {
  Bytes,
  GeoPoint,
  Timestamp,
  connectFirestoreEmulator,
  doc,
  getFirestore,
  runTransaction,
  vector,
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
    types: {
      timestamp: (date) => Timestamp.fromDate(date),
      geoPoint: (latitude, longitude) => new GeoPoint(latitude, longitude),
      bytes: (bytes) => Bytes.fromUint8Array(Uint8Array.from(bytes)),
      vector: (value) => vector(value),
      documentReference: (path) => doc(db, path),
    },
    db: {
      writeBatch: () => writeBatch(db),
      transaction: (runner) => runTransaction(db, runner),
    },
  });
});
