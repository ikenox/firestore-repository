// oxlint-disable no-unused-vars
import { initializeApp } from '@firebase/app';
import {
  connectFirestoreEmulator,
  getFirestore,
  runTransaction,
  writeBatch,
} from '@firebase/firestore';
import { newRootCollectionRepository as newFirebaseJsSdkRepository } from '@firestore-repository/firebase-js-sdk';
import {
  type GoogleCloudFirestoreRepository,
  newRepositoryWithMapper as newGoogleCloudFirestoreRepositoryWithMapper,
  newRootCollectionRepository as newGoogleCloudFirestoreRepository,
} from '@firestore-repository/google-cloud-firestore';
import { Firestore } from '@google-cloud/firestore';
import { randomString } from 'firestore-repository/__test__/util';
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

type UsersCollection = typeof users;

const defineReadmeExampleTests = <Env extends FirestoreEnvironment>({
  db,
  createRepository,
  onlyGoogleCloudFirestore = () => {},
}: {
  createRepository: <T extends RootCollection>(
    collection: T,
  ) => Repository<T, RootCollectionPlainModel<T>, Env>;
  db: {
    writeBatch: () => Env['writeBatch'] & { commit(): Promise<unknown> };
    transaction: <T>(runner: (tx: Env['transaction']) => Promise<T>) => Promise<T>;
  };
  onlyGoogleCloudFirestore?: (
    name: string,
    fn: (
      repository: GoogleCloudFirestoreRepository<
        UsersCollection,
        RootCollectionPlainModel<UsersCollection>
      >,
    ) => Promise<void>,
  ) => void;
}) => {
  const repository = createRepository({ ...users, name: `${users.name}-${randomString()}` });

  describe('Basic operations for a single document', () => {
    it('set', async () => {
      await repository.set({
        ref: 'user1',
        data: { name: 'John Doe', profile: { age: 42, gender: 'male' }, tag: ['new'] },
      });
    });

    onlyGoogleCloudFirestore('create', async (repository) => {
      await repository.create({
        ref: 'user2',
        data: { name: 'Charlie', profile: { age: 25, gender: 'male' }, tag: [] },
      });
    });

    it('get', async () => {
      const doc = await repository.get('user1');
    });

    it('getOnSnapshot', () => {
      repository.getOnSnapshot('user1', (doc) => {
        console.log(doc);
      });
    });

    it('delete', async () => {
      await repository.delete('user2');
    });
  });

  describe('Query', () => {
    const q = query(
      { collection: users },
      $('profile.age', '>=', 20),
      $('profile.gender', '==', 'male'),
      limit(10),
    );

    it('list', async () => {
      const docs = await repository.list(q);
    });

    it('listOnSnapshot', () => {
      repository.listOnSnapshot(q, (docs) => {
        console.log(docs);
      });
    });

    it('aggregate', async () => {
      const result = await repository.aggregate(q, {
        avgAge: average('profile.age'),
        sumAge: sum('profile.age'),
        count: count(),
      });
      console.log(`avg:${result.avgAge} sum:${result.sumAge} count:${result.count}`);
    });
  });

  describe('Batch operations', () => {
    it('batchSet', async () => {
      await repository.batchSet([
        {
          ref: 'user1',
          data: { name: 'Alice', profile: { age: 30, gender: 'female' }, tag: ['new'] },
        },
        { ref: 'user2', data: { name: 'Bob', profile: { age: 20, gender: 'male' }, tag: [] } },
      ]);
    });

    it('batchDelete', async () => {
      await repository.batchDelete(['user1', 'user2']);
    });

    onlyGoogleCloudFirestore('Get multiple documents', async (repository) => {
      const users = await repository.batchGet(['user1', 'user2']);
    });

    it('include multiple different operations in a batch', async () => {
      const batch = db.writeBatch();
      await repository.set(
        { ref: 'user3', data: { name: 'Bob', profile: { age: 20, gender: 'male' }, tag: [] } },
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
  });

  it('Transaction', async () => {
    await db.transaction(async (tx) => {
      const doc = await repository.get('user1', { tx });

      if (doc) {
        doc.data.tag = [...doc.data.tag, 'new-tag'];
        await repository.set(doc, { tx });
        await repository.batchSet(
          [
            { ...doc, ref: 'user2' },
            { ...doc, ref: 'user3' },
          ],
          { tx },
        );
      }

      await repository.delete('user4', { tx });
      await repository.batchDelete(['user5', 'user6'], { tx });
    });
  });
};

describe('README example', () => {
  describe('firebase-js-sdk', () => {
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

  describe('google-cloud-firestore', () => {
    const db = new Firestore({
      projectId: process.env['FIRESTORE_TEST_PROJECT']!,
      databaseId: process.env['FIRESTORE_TEST_DB']!,
    });

    defineReadmeExampleTests({
      createRepository: (collection) => newGoogleCloudFirestoreRepository(db, collection),
      db: { writeBatch: () => db.batch(), transaction: (runner) => db.runTransaction(runner) },
      onlyGoogleCloudFirestore: (name, fn) => {
        const repo = newGoogleCloudFirestoreRepositoryWithMapper(
          db,
          users,
          rootCollectionPlainMapper(users),
        );
        it(name, () => fn(repo));
      },
    });
  });
});
