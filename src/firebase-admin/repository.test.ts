import admin from 'firebase-admin';
import { Timestamp as AdminTimestamp, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { defineRepositorySpecificationTests } from '../__test__/specification.js';
import { Repository } from './repository.js';

describe('repository', async () => {
  const db = getFirestore(
    admin.initializeApp({ projectId: process.env['TEST_PROJECT']! }),
    process.env['TEST_DB']!,
  );

  defineRepositorySpecificationTests((collection) => new Repository(collection, db), {
    timestamp: (date) => Timestamp.fromDate(date),
  });
});
