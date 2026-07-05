import { initializeApp } from '@firebase/app';
import {
  connectFirestoreEmulator,
  getFirestore,
  runTransaction,
  writeBatch,
} from '@firebase/firestore';
import { definePipelineSpecificationTests } from 'firestore-repository/__test__/pipeline-spec';
import { defineRepositorySpecificationTests } from 'firestore-repository/__test__/specification';
import { plainMapper } from 'firestore-repository/repository';
import { describe } from 'vitest';

import { type Env, repositoryWithMapper } from './index.js';
import { executor as pipelineExecutor } from './pipeline.js';

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

  // Pipeline queries require a Firestore Enterprise database (the emulator
  // cannot run them). These tests run only when both FIRESTORE_ENTERPRISE_TEST_*
  // env vars are set; otherwise vitest reports them as skipped.
  const enterpriseProject = process.env['FIRESTORE_ENTERPRISE_TEST_PROJECT'];
  const enterpriseDbId = process.env['FIRESTORE_ENTERPRISE_TEST_DB'];
  describe.skipIf(!enterpriseProject || !enterpriseDbId)('pipeline', () => {
    // A separate app/db targeting the real Enterprise backend (not the emulator).
    const enterpriseDb = getFirestore(
      initializeApp({ projectId: enterpriseProject ?? '' }, 'pipeline-enterprise'),
      enterpriseDbId ?? '(default)',
    );
    definePipelineSpecificationTests<Env>({
      executor: pipelineExecutor(enterpriseDb),
      createRepository: (collection) =>
        repositoryWithMapper(enterpriseDb, collection, plainMapper(collection)),
    });
  });
});
