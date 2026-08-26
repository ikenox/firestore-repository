// oxlint-disable no-unused-vars
import { initializeApp } from '@firebase/app';
import {
  connectFirestoreEmulator,
  getFirestore,
  runTransaction,
  writeBatch,
} from '@firebase/firestore';
import {
  repositoryWithMapper as firebaseJsSdkRepositoryWithMapper,
  rootCollectionRepository as firebaseJsSdkRepository,
  subcollectionRepository as firebaseJsSdkSubcollectionRepository,
} from '@firestore-repository/firebase-js-sdk';
import { executor as firebaseJsSdkPipelineExecutor } from '@firestore-repository/firebase-js-sdk/pipeline';
import {
  type GoogleCloudFirestoreRepository,
  repositoryWithMapper as googleCloudFirestoreRepositoryWithMapper,
  rootCollectionRepository as googleCloudFirestoreRepository,
  subcollectionRepository as googleCloudFirestoreSubcollectionRepository,
  toSdkQuery,
} from '@firestore-repository/google-cloud-firestore';
import {
  executor as googleCloudFirestorePipelineExecutor,
  fromSdkPipelineResults,
  toSdkPipeline,
} from '@firestore-repository/google-cloud-firestore/pipeline';
import { Firestore } from '@google-cloud/firestore';
import { randomString, uniqueCollection } from 'firestore-repository/__test__/util';
import { average, count, sum } from 'firestore-repository/aggregate';
import {
  average as pipelineAverage,
  countAll as pipelineCountAll,
  greaterThanOrEqual as pipelineGreaterThanOrEqual,
} from 'firestore-repository/pipelines/expression';
import { asc as pipelineAsc } from 'firestore-repository/pipelines/ordering';
import type { PipelineQueryExecutor } from 'firestore-repository/pipelines/pipeline';
import { collection as pipelineCollection } from 'firestore-repository/pipelines/source';
import { collection, eq, gte, limit, query, where } from 'firestore-repository/query';
import type {
  AppModel,
  FirestoreEnvironment,
  Mapper,
  PlainModel,
  Repository,
  RootCollectionPlainModel,
} from 'firestore-repository/repository';
import { rootCollectionPlainMapper } from 'firestore-repository/repository';
import {
  array,
  double,
  literal,
  map,
  optional,
  type RootCollection,
  rootCollection,
  string,
  type SubCollection,
  subCollection,
} from 'firestore-repository/schema';
import { beforeAll, describe, it } from 'vitest';

const console = {
  log: (_arg: unknown) => {
    /*no-op*/
  },
};

// define a collection
const users = rootCollection({
  name: 'Authors',
  schema: {
    name: string(),
    profile: map({ age: double(), gender: optional(literal('male', 'female')) }),
    tag: array(string()),
  },
});

// define a subcollection
const posts = subCollection({
  name: 'Posts',
  schema: { title: string() },
  parent: ['Authors'] as const,
});

type UsersCollection = typeof users;

// Defined at module scope because the README's "Custom Mapper" section and its
// pipeline counterpart share one mapper — the point of the latter being that no
// pipeline-specific mapper is needed.
type User = {
  id: string;
  name: string;
  profile: { age: number; gender?: 'male' | 'female' };
  tag: string[];
};

const userMapper: Mapper<UsersCollection, AppModel<string, User, User>> = {
  toDocRef: (id) => [id],
  fromFirestore: (doc) => ({ id: doc.id[0], ...doc.data }),
  toFirestore: (user) => ({
    id: [user.id],
    data: { name: user.name, profile: user.profile, tag: user.tag },
  }),
};

const defineReadmeExampleTests = <Env extends FirestoreEnvironment>({
  db,
  createRepository,
  createRepositoryWithMapper,
  createSubcollectionRepository,
  onlyGoogleCloudFirestore = () => {},
  pipeline,
}: {
  createRepository: <T extends RootCollection>(
    collection: T,
  ) => Repository<T, RootCollectionPlainModel<T>, Env>;
  createRepositoryWithMapper: <T extends RootCollection, Model extends AppModel>(
    collection: T,
    mapper: Mapper<T, Model>,
  ) => Repository<T, Model, Env>;
  createSubcollectionRepository: <T extends SubCollection>(
    collection: T,
  ) => Repository<T, PlainModel<T>, Env>;
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
  // Pipeline queries require a Firestore Enterprise database (the emulator
  // cannot run them), so the adapter supplies the executor and an
  // Enterprise-backed repository for seeding only when the integration env is
  // configured; otherwise this stays undefined and the block is skipped.
  pipeline?: {
    executor: PipelineQueryExecutor;
    createRepository: <T extends RootCollection>(
      collection: T,
    ) => Repository<T, RootCollectionPlainModel<T>, Env>;
    // README's "Accessing the underlying SDK": runs a pipeline through
    // `toSdkPipeline` / `fromSdkPipelineResults` instead of the executor.
    //
    // Typed as `execute` itself on purpose — that the escape hatch can stand
    // in for the executor, same argument and same rows out, is exactly what
    // the test checks, so the signature states it before any assertion runs.
    //
    // Optional because only the backend adapter supplies one: the section's
    // example passes `explainOptions`, which the client SDK has no equivalent
    // of.
    executeViaSdk?: PipelineQueryExecutor['execute'];
  };
}) => {
  // A per-run collection name keeps the examples from colliding; `as const`
  // keeps the name a literal, which the query constraints resolve against.
  const collectionDef = { ...users, name: `${users.name}-${randomString()}` } as const;
  const repository = createRepository(collectionDef);

  describe('Basic operations for a single document', () => {
    it('set', async () => {
      await repository.set({
        id: 'user1',
        data: { name: 'John Doe', profile: { age: 42, gender: 'male' }, tag: ['new'] },
      });
    });

    onlyGoogleCloudFirestore('create', async (repository) => {
      await repository.create({
        id: 'user2',
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
      collection(collectionDef),
      where(gte('profile.age', 20)),
      where(eq('profile.gender', 'male')),
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
          id: 'user1',
          data: { name: 'Alice', profile: { age: 30, gender: 'female' }, tag: ['new'] },
        },
        { id: 'user2', data: { name: 'Bob', profile: { age: 20, gender: 'male' }, tag: [] } },
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
        { id: 'user3', data: { name: 'Bob', profile: { age: 20, gender: 'male' }, tag: [] } },
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
            { ...doc, id: 'user2' },
            { ...doc, id: 'user3' },
          ],
          { tx },
        );
      }

      await repository.delete('user4', { tx });
      await repository.batchDelete(['user5', 'user6'], { tx });
    });
  });

  describe('Subcollection', () => {
    const subcollectionRepository = createSubcollectionRepository({
      ...posts,
      name: `${posts.name}-${randomString()}`,
    });

    it('set', async () => {
      await subcollectionRepository.set({
        id: ['user1', 'post1'],
        data: { title: 'My first post' },
      });
    });

    it('get', async () => {
      const doc = await subcollectionRepository.get(['user1', 'post1']);
    });
  });

  describe('Custom mapper', () => {
    const userRepository = createRepositoryWithMapper(
      { ...users, name: `${users.name}-${randomString()}` },
      userMapper,
    );

    it('set and get', async () => {
      await userRepository.set({
        id: 'user1',
        name: 'Alice',
        profile: { age: 30, gender: 'female' },
        tag: ['new'],
      });
      const user = await userRepository.get('user1');
      console.log(user);
    });

    it('delete', async () => {
      await userRepository.delete('user1');
    });
  });

  describe.skipIf(!pipeline)('Pipeline Query', () => {
    // A fresh collection instance seeded on the Enterprise DB for this run.
    const authors = { ...users, name: `${users.name}-${randomString()}` };

    beforeAll(async () => {
      await pipeline!.createRepository(authors).batchSet([
        { id: 'a1', data: { name: 'Alice', profile: { age: 30, gender: 'female' }, tag: [] } },
        { id: 'a2', data: { name: 'Bob', profile: { age: 20, gender: 'male' }, tag: [] } },
        { id: 'a3', data: { name: 'Carol', profile: { age: 40, gender: 'female' }, tag: [] } },
      ]);
    });

    it('aggregate', async () => {
      const q = pipelineCollection(authors)
        .where((field) => pipelineGreaterThanOrEqual(field('profile.age'), 20))
        .aggregate((field) => ({
          groups: [field('profile.gender').as('gender')],
          accumulators: [
            pipelineAverage(field('profile.age')).as('avgAge'),
            pipelineCountAll().as('count'),
          ],
        }));
      const rows = await pipeline!.executor.execute(q);
      console.log(rows);
    });

    it('applying a mapper to the results', async () => {
      const identified = await pipeline!.executor.execute(
        pipelineCollection(authors)
          .where((field) => pipelineGreaterThanOrEqual(field('profile.age'), 20))
          .sort((field) => [pipelineAsc(field('name'))])
          .limit(10),
      );

      // Reuses the `userMapper` defined in "Custom Mapper" above
      const found: User[] = identified.map(userMapper.fromFirestore);
      console.log(found);

      // Type-checked but deliberately never invoked: the `@ts-expect-error`
      // is the assertion, and running it would throw on the absent `id`.
      const rejectedAtCompileTime = async () => {
        const projected = await pipeline!.executor.execute(
          pipelineCollection(authors).select((field) => [field('name')]),
        );
        // @ts-expect-error `select` dropped read-identity, so the rows have no `id`
        projected.map(userMapper.fromFirestore);
      };
    });

    // README's "Accessing the underlying SDK", pipeline half: the same query as
    // the test above, but run through `toSdkPipeline` -> the SDK's `execute()`
    // -> `fromSdkPipelineResults` instead of through the executor. The adapter
    // passes `explainOptions` on the way, which is the reason the escape hatch
    // exists at all — the executor has nowhere to put them.
    //
    // What is asserted is the `User[]` annotation. `userMapper.fromFirestore`
    // takes a `Doc<T>`, so rows that came back through the SDK have to arrive
    // both shaped like `execute()`'s and still carrying read-identity: a
    // decoder that dropped `id`, or reshaped `data`, stops compiling here (and
    // would throw on the absent `id` if it somehow did not). Read it against
    // the executor-based test above — the two paths must agree.
    //
    // Runs only where the Enterprise integration env is configured, since that
    // is the only place the adapter supplies `executeViaSdk`.
    it.skipIf(!pipeline?.executeViaSdk)('accessing the underlying SDK', async () => {
      const rows = await pipeline!.executeViaSdk!(
        pipelineCollection(authors)
          .where((field) => pipelineGreaterThanOrEqual(field('profile.age'), 20))
          .sort((field) => [pipelineAsc(field('name'))])
          .limit(10),
      );

      const found: User[] = rows.map(userMapper.fromFirestore);
      console.log(found);
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

    // Pipeline queries need a real Enterprise DB and, for the client SDK, a real
    // API key — build the executor only when all three integration vars are set.
    const enterpriseProject = process.env['FIRESTORE_REPOSITORY_INTEGRATION_TEST_PROJECT'];
    const enterpriseDbId = process.env['FIRESTORE_REPOSITORY_INTEGRATION_TEST_DB'];
    const clientApiKey = process.env['FIRESTORE_REPOSITORY_INTEGRATION_TEST_CLIENT_API_KEY'];
    const enterpriseDb =
      enterpriseProject && enterpriseDbId && clientApiKey
        ? getFirestore(
            initializeApp(
              { projectId: enterpriseProject, apiKey: clientApiKey },
              'readme-pipeline',
            ),
            enterpriseDbId,
          )
        : undefined;

    defineReadmeExampleTests({
      createRepository: (collection) => firebaseJsSdkRepository(db, collection),
      createRepositoryWithMapper: (collection, mapper) =>
        firebaseJsSdkRepositoryWithMapper(db, collection, mapper),
      createSubcollectionRepository: (collection) =>
        firebaseJsSdkSubcollectionRepository(db, collection),
      db: { writeBatch: () => writeBatch(db), transaction: (runner) => runTransaction(db, runner) },
      ...(enterpriseDb
        ? {
            pipeline: {
              executor: firebaseJsSdkPipelineExecutor(enterpriseDb),
              createRepository: (collection) => firebaseJsSdkRepository(enterpriseDb, collection),
            },
          }
        : {}),
    });
  });

  describe('google-cloud-firestore', () => {
    const db = new Firestore({
      projectId: process.env['FIRESTORE_TEST_PROJECT']!,
      databaseId: process.env['FIRESTORE_TEST_DB']!,
    });

    // Pipeline queries need a real Enterprise DB (the admin SDK authenticates via
    // ADC, so no API key is needed). Build it with the emulator host temporarily
    // removed so the SDK targets the real backend, not the emulator.
    const enterpriseProject = process.env['FIRESTORE_REPOSITORY_INTEGRATION_TEST_PROJECT'];
    const enterpriseDbId = process.env['FIRESTORE_REPOSITORY_INTEGRATION_TEST_DB'];
    let enterpriseDb: Firestore | undefined;
    if (enterpriseProject && enterpriseDbId) {
      const emulatorHost = process.env['FIRESTORE_EMULATOR_HOST'];
      delete process.env['FIRESTORE_EMULATOR_HOST'];
      enterpriseDb = new Firestore({ projectId: enterpriseProject, databaseId: enterpriseDbId });
      if (emulatorHost !== undefined) {
        process.env['FIRESTORE_EMULATOR_HOST'] = emulatorHost;
      }
    }

    defineReadmeExampleTests({
      createRepository: (collection) => googleCloudFirestoreRepository(db, collection),
      createRepositoryWithMapper: (collection, mapper) =>
        googleCloudFirestoreRepositoryWithMapper(db, collection, mapper),
      createSubcollectionRepository: (collection) =>
        googleCloudFirestoreSubcollectionRepository(db, collection),
      db: { writeBatch: () => db.batch(), transaction: (runner) => db.runTransaction(runner) },
      onlyGoogleCloudFirestore: (name, fn) => {
        const repo = googleCloudFirestoreRepositoryWithMapper(
          db,
          uniqueCollection(users),
          rootCollectionPlainMapper(users),
        );
        it(name, () => fn(repo));
      },
      ...(enterpriseDb
        ? {
            pipeline: {
              executor: googleCloudFirestorePipelineExecutor(enterpriseDb),
              createRepository: (collection) =>
                googleCloudFirestoreRepository(enterpriseDb, collection),
              executeViaSdk: async (p) => {
                const snapshot = await toSdkPipeline(enterpriseDb, p).execute({
                  explainOptions: { mode: 'analyze', outputFormat: 'text' },
                });
                console.log(snapshot.explainStats?.text);
                return fromSdkPipelineResults(p, snapshot);
              },
            },
          }
        : {}),
    });

    // README's "Accessing the underlying SDK", query half. Backend only: the
    // section's worked example is Query Explain, which the client SDK has no
    // equivalent of.
    describe('Accessing the underlying SDK', () => {
      const q = query(collection(users), where(gte('profile.age', 20)), limit(10));

      // That a built query reaches the SDK at all: `toSdkQuery` has to accept
      // a query this library built and hand back something the SDK's own
      // methods hang off. Nothing is executed, because the point of the escape
      // hatch is what the caller does with the object afterwards, and every
      // such method belongs to the SDK rather than to this library.
      it('builds the SDK query', () => {
        const sdkQuery = toSdkQuery(db, q);
        console.log(sdkQuery);
      });

      // The README snippet itself, type-checked but deliberately never
      // invoked: Query Explain needs a real backend, and the emulator answers
      // any explain request with "No explain results" (probed). Declaring it
      // still pins the shape the snippet relies on — `explain({analyze})`
      // exists on what `toSdkQuery` returns, and its metrics carry
      // `planSummary.indexesUsed` and `executionStats`. A signature change in
      // the SDK breaks the build here rather than only the docs.
      const explain = async () => {
        const { metrics } = await toSdkQuery(db, q).explain({ analyze: true });
        console.log(metrics.planSummary.indexesUsed);
        console.log(metrics.executionStats?.resultsReturned);
      };
    });
  });
});
