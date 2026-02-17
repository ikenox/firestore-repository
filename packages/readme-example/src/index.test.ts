import { initializeApp } from '@firebase/app';
import {
  connectFirestoreEmulator,
  getFirestore,
  runTransaction,
  writeBatch,
} from '@firebase/firestore';
import { newRootCollectionRepository as newFirebaseJsSdkRepository } from '@firestore-repository/firebase-js-sdk';
import {
  newRepositoryWithMapper as newGoogleCloudFirestoreRepositoryWithMapper,
  newRootCollectionRepository as newGoogleCloudFirestoreRepository,
} from '@firestore-repository/google-cloud-firestore';
import { Firestore } from '@google-cloud/firestore';
import { average, count, sum } from 'firestore-repository/aggregate';
import { condition as $, limit, query } from 'firestore-repository/query';
import type {
  FirestoreEnvironment,
  Repository,
  RootCollectionPlainModel,
} from 'firestore-repository/repository';
import { rootCollectionPlainMapper } from 'firestore-repository/repository';
import {
  type RootCollection,
  rootCollection,
  schemaWithoutValidation,
} from 'firestore-repository/schema';
import { describe, it } from 'vitest';

const console = {
  log: (_arg: unknown) => {
    /*no-op*/
  },
};

// define a collection
const users = rootCollection({
  name: 'Authors',
  data: schemaWithoutValidation<{
    name: string;
    profile: { age: number; gender?: 'male' | 'female' };
    tag: string[];
  }>(),
});

const defineReadmeExampleTests = <Env extends FirestoreEnvironment>({
  db,
  createRepository,
}: {
  createRepository: <T extends RootCollection>(
    collection: T,
  ) => Repository<T, RootCollectionPlainModel<T>, Env>;
  db: {
    writeBatch: () => Env['writeBatch'] & { commit(): Promise<unknown> };
    transaction: <T>(runner: (tx: Env['transaction']) => Promise<T>) => Promise<T>;
  };
}) => {
  const repository = createRepository(users);

  it('basic usage', async () => {
    // set
    await repository.set({
      ref: ['user1'],
      data: { name: 'John Doe', profile: { age: 42, gender: 'male' }, tag: ['new'] },
    });

    // get
    const doc = await repository.get('user1');
    console.log(doc);

    // delete
    await repository.delete('user2');

    // query
    const q = query(
      { collection: users },
      $('profile.age', '>=', 20),
      $('profile.gender', '==', 'male'),
      limit(10),
    );
    const docs = await repository.list(q);
    console.log(docs);

    // listen document
    repository.getOnSnapshot('user1', (doc) => {
      console.log(doc);
    });

    // listen query
    repository.listOnSnapshot(q, (docs) => {
      console.log(docs);
    });

    // aggregate
    const result = await repository.aggregate(q, {
      avgAge: average('profile.age'),
      sumAge: sum('profile.age'),
      count: count(),
    });
    console.log(`avg:${result.avgAge} sum:${result.sumAge} count:${result.count}`);
  });

  it('batch operation', async () => {
    // set
    await repository.batchSet([
      {
        ref: ['user1'],
        data: { name: 'Alice', profile: { age: 30, gender: 'female' }, tag: ['new'] },
      },
      { ref: ['user2'], data: { name: 'Bob', profile: { age: 20, gender: 'male' }, tag: [] } },
    ]);

    // delete
    await repository.batchDelete(['user1', 'user2']);

    // mix multiple operations
    const batch = db.writeBatch();
    await repository.set(
      { ref: ['user3'], data: { name: 'Bob', profile: { age: 20, gender: 'male' }, tag: [] } },
      { tx: batch },
    );
    await repository.batchSet(
      [
        // ...
      ],
      { tx: batch },
    );
    await repository.delete('user4', { tx: batch });
    await repository.batchDelete(['user5', 'user6'], { tx: batch });
    await batch.commit();
  });

  it('transaction', async () => {
    await db.transaction(async (tx) => {
      // get
      const doc = await repository.get('user1', { tx });

      if (doc) {
        doc.data.tag = [...doc.data.tag, 'new-tag'];
        // set
        await repository.set(doc, { tx });
        await repository.batchSet(
          [
            { ...doc, ref: ['user2'] },
            { ...doc, ref: ['user3'] },
          ],
          { tx },
        );
      }

      // delete
      await repository.delete('user4', { tx });
      await repository.batchDelete(['user5', 'user6'], { tx });
    });
  });
};

describe('README example (firebase-js-sdk)', () => {
  const db = getFirestore(
    initializeApp({ projectId: process.env['FIRESTORE_TEST_PROJECT']! }),
    process.env['FIRESTORE_TEST_DB']!,
  );

  const emulatorHost = process.env['FIRESTORE_EMULATOR_HOST'];
  if (emulatorHost) {
    const [host, port] = emulatorHost.split(':');
    connectFirestoreEmulator(db, host!, Number(port));
  }

  defineReadmeExampleTests({
    createRepository: (collection) => newFirebaseJsSdkRepository(db, collection),
    db: { writeBatch: () => writeBatch(db), transaction: (runner) => runTransaction(db, runner) },
  });
});

describe('README example (google-cloud-firestore)', () => {
  const db = new Firestore({
    projectId: process.env['FIRESTORE_TEST_PROJECT']!,
    databaseId: process.env['FIRESTORE_TEST_DB']!,
  });

  defineReadmeExampleTests({
    createRepository: (collection) => newGoogleCloudFirestoreRepository(db, collection),
    db: { writeBatch: () => db.batch(), transaction: (runner) => db.runTransaction(runner) },
  });

  // google-cloud-firestore only operations
  const repository = newGoogleCloudFirestoreRepositoryWithMapper(
    db,
    users,
    rootCollectionPlainMapper(users),
  );

  it('create', async () => {
    await repository.delete('user-create-test');
    await repository.create({
      ref: ['user-create-test'],
      data: { name: 'Charlie', profile: { age: 25, gender: 'male' }, tag: [] },
    });
  });

  it('batchGet', async () => {
    const docs = await repository.batchGet(['user1', 'user2']);
    console.log(docs);
  });
});
