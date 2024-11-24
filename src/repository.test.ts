import admin from 'firebase-admin';
import { Timestamp as AdminTimestamp, getFirestore } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { repositorySpecification } from './__test__/specification.js';
import { Repository } from './repository.js';

describe('repository', async () => {
  const db = getFirestore(
    admin.initializeApp({ projectId: process.env['TEST_PROJECT']! }),
    process.env['TEST_DB']!,
  );

  repositorySpecification((collection) => new Repository(collection, db));
});
