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
  // cannot run them). Unlike the admin SDK (which authenticates via ADC and
  // bypasses security rules), the client SDK needs a real Firebase API key —
  // so these tests additionally require FIRESTORE_REPOSITORY_INTEGRATION_TEST_CLIENT_API_KEY
  // on top of the FIRESTORE_REPOSITORY_INTEGRATION_TEST_* vars; otherwise
  // vitest reports them as skipped (and a root `pnpm test` with only the two
  // shared vars set still runs the admin adapter live without failing here).
  const enterpriseProject = process.env['FIRESTORE_REPOSITORY_INTEGRATION_TEST_PROJECT'];
  const enterpriseDbId = process.env['FIRESTORE_REPOSITORY_INTEGRATION_TEST_DB'];
  const clientApiKey = process.env['FIRESTORE_REPOSITORY_INTEGRATION_TEST_CLIENT_API_KEY'];
  describe.skipIf(!enterpriseProject || !enterpriseDbId || !clientApiKey)('pipeline', () => {
    // A separate app/db targeting the real Enterprise backend (not the emulator).
    const enterpriseDb = getFirestore(
      initializeApp(
        { projectId: enterpriseProject ?? '', apiKey: clientApiKey ?? '' },
        'pipeline-enterprise',
      ),
      enterpriseDbId ?? '(default)',
    );
    definePipelineSpecificationTests<Env>({
      executor: pipelineExecutor(enterpriseDb),
      createRepository: (collection) =>
        repositoryWithMapper(enterpriseDb, collection, plainMapper(collection)),
    });
  });
});
