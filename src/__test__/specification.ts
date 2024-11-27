import { beforeAll, describe, expect, it } from 'vitest';
import { type CollectionSchema, type Repository, type Timestamp, as, collection } from '../index.js';
import { deleteAll, randomNumber, randomString } from './util.js';

/**
 * List of specifications that repository implementations must satisfy
 */
export const defineRepositorySpecificationTests = <Repo extends Repository>(
  repository: <T extends CollectionSchema>(collection: T) => Repo,
  environment: {
    converters: {
      timestamp: (date: Date) => Timestamp;
    };
    implementationSpecificTests?: <T extends CollectionSchema>(
      params: TestCollectionParams<T>,
      testWithDb: TestWithDb<Repo>,
    ) => void;
  },
) => {
  const converters = environment.converters;

  const defineTests = <T extends CollectionSchema>(params: TestCollectionParams<T>) => {
    const testWithDb: TestWithDb<Repo> = (label, test) => {
      it(label, async () => {
        const repo = repository({
          ...params.collection,
          // use unique collection for each test
          name: `${params.collection.name}_${randomString()}`,
        });
        // setup initial data
        await repo.batchSet(params.initial);

        await test({ repository: repo });
      });
    };

    describe(params.title, async () => {
      const dataList = params.initial;

      describe('get', () => {
        testWithDb('exists', async ({ repository }) => {
          const dataFromDb = await repository.get(dataList[0]);
          expect(dataFromDb).toStrictEqual(dataList[0]);
        });

        testWithDb('not found', async ({ repository }) => {
          expect(await repository.get(params.notExistDocId())).toBeUndefined();
        });
      });

      describe('set', () => {
        const newData = params.newData();

        testWithDb('create', async ({ repository }) => {
          await repository.set(newData);
          // TODO assertion
          expect(await repository.get(newData)).toStrictEqual(newData);
        });

        testWithDb('update', async ({ repository }) => {
          const updated = params.mutate(newData);
          await repository.set(updated);
          // TODO assertion
          expect(await repository.get(newData)).toStrictEqual(updated);
        });
      });

      describe('delete', () => {
        testWithDb('success', async ({ repository }) => {
          await repository.delete(dataList[0]);
          expect(await repository.get(dataList[0])).toBeUndefined();
        });

        testWithDb('if not exists', async ({ repository }) => {
          await repository.delete(dataList[0]);
          expect(await repository.get(dataList[0])).toBeUndefined();
          await repository.delete(dataList[0]);
          expect(await repository.get(dataList[0])).toBeUndefined();
        });
      });

      if (environment.implementationSpecificTests) {
        describe('implementation-specific tests', () => {
          environment.implementationSpecificTests?.(params, testWithDb);
        });
      }
    });
  };

  describe('repository specifications', () => {
    defineTests({
      title: 'root collection',
      collection: authorsCollection,
      initial: [
        {
          authorId: 'author0',
          name: 'name0',
          registeredAt: converters.timestamp(new Date()),
        },
        {
          authorId: 'author1',
          name: 'name1',
          registeredAt: converters.timestamp(new Date()),
        },
        {
          authorId: 'author2',
          name: 'name2',
          registeredAt: converters.timestamp(new Date()),
        },
      ],
      newData: () => {
        const id = randomNumber();
        return {
          authorId: `author${id}`,
          name: `name${id}`,
          registeredAt: converters.timestamp(new Date()),
        };
      },
      mutate: (data) => ({
        ...data,
        name: `${data.name}_updated`,
      }),
      notExistDocId: () => ({ authorId: 'not-exists' }),
    });

    defineTests({
      title: 'subcollection',
      collection: postsCollection,
      initial: [
        {
          postId: 0,
          title: 'post0',
          authorId: 'author0',
          postedAt: converters.timestamp(new Date()),
        },
        {
          postId: 1,
          title: 'post1',
          authorId: 'author0',
          postedAt: converters.timestamp(new Date()),
        },
        {
          postId: 2,
          title: 'post2',
          authorId: 'author1',
          postedAt: converters.timestamp(new Date()),
        },
      ],
      newData: () => {
        const id = randomNumber();
        const authorId = randomNumber();
        return {
          postId: id,
          title: `post${id}`,
          authorId: `author${authorId}`,
          postedAt: converters.timestamp(new Date()),
        };
      },
      mutate: (data) => ({
        ...data,
        title: `${data.title}_updated`,
      }),
      notExistDocId: () => ({ postId: randomNumber(), authorId: 'post0' }),
    });
  });
};

export type TestCollectionParams<T extends CollectionSchema = CollectionSchema> = {
  title: string;
  collection: T;
  initial: [T['$model'], T['$model'], T['$model']];
  newData: () => T['$model'];
  mutate: (data: T['$model']) => T['$model'];
  notExistDocId: () => T['$id'];
};

export type TestWithDb<T extends Repository = Repository> = (
  label: string,
  test: (context: {
    repository: T;
  }) => Promise<void>,
) => void;

/**
 * Root collection
 */
const authorsCollection = collection({
  name: 'Authors',
  id: as('authorId'),
  data: {
    from: (data: { name: string; registeredAt: Timestamp }) => ({
      ...data,
    }),
    to: ({ name, registeredAt }) => ({
      name,
      registeredAt,
    }),
  },
});

/**
 * Subcollection
 */
const postsCollection = collection({
  name: 'Posts',
  id: {
    from: (postId) => ({ postId: Number(postId) }),
    to: ({ postId }) => postId.toString(),
  },
  parent: {
    schema: authorsCollection,
    id: {
      from: ({ authorId }) => ({ authorId }),
      to: (data) => ({ authorId: data.authorId }),
    },
  },
  data: {
    from: (data: { title: string; postedAt: Timestamp }) => ({
      ...data,
    }),
    to: (data) => ({ ...data }),
  },
});
