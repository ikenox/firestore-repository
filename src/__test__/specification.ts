import { beforeEach, describe, expect, it } from 'vitest';
import {
  type CollectionSchema,
  type Id,
  type Model,
  type Repository,
  type Timestamp,
  as,
  collection,
} from '../index.js';
import { randomNumber, randomString } from './util.js';

export type RepositoryTestEnv<Repo extends Repository> = {
  repository: Repo;
  items: [Model<Repo['collection']>, Model<Repo['collection']>, Model<Repo['collection']>];
  expectDb: (expected: Model<Repo['collection']>[]) => Promise<void>;
};

/**
 * List of specifications that repository implementations must satisfy
 */
export const defineRepositorySpecificationTests = <Repo extends Repository>(
  createRepository: <T extends CollectionSchema>(collection: T) => Repo,
  environment: {
    converters: {
      timestamp: (date: Date) => Timestamp;
    };
    implementationSpecificTests?: <T extends CollectionSchema>(
      params: TestCollectionParams<T>,
      setup: () => RepositoryTestEnv<Repo>,
    ) => void;
  },
) => {
  const converters = environment.converters;

  const defineTests = <T extends CollectionSchema>(params: TestCollectionParams<T>) => {
    const setup = (): RepositoryTestEnv<Repo> => {
      const items = [params.newData(), params.newData(), params.newData()] as [
        Model<T>,
        Model<T>,
        Model<T>,
      ];

      const repository = createRepository(params.collection);
      beforeEach(async () => {
        repository.collection = {
          ...params.collection,
          // use dedicated collection for each tests
          name: `${params.collection.name}_${randomString()}`,
        };
        await repository.batchSet(items);
      });

      return {
        repository,
        items,
        expectDb: async (expected: Model<T>[]) => {
          const items = (await repository.list(repository.collectionGroupQuery())) as Model<T>[];
          expect(
            items.toSorted((a, b) => params.sortKey(a).localeCompare(params.sortKey(b))),
          ).toStrictEqual(
            expected.toSorted((a, b) => params.sortKey(a).localeCompare(params.sortKey(b))),
          );
        },
      };
    };

    describe(params.title, async () => {
      const { repository, items, expectDb } = setup();

      describe('get', () => {
        it('exists', async () => {
          expect(await repository.get(items[0])).toStrictEqual(items[0]);
        });

        it('not found', async () => {
          expect(await repository.get(params.notExistDocId())).toBeUndefined();
        });
      });

      describe('set', () => {
        const newItem = params.newData();

        it('create', async () => {
          await repository.set(newItem);
          await expectDb([...items, newItem]);
        });

        it('update', async () => {
          const [target, ...rest] = items;
          const updated = params.mutate(target);
          await repository.set(updated);
          await expectDb([updated, ...rest]);
        });
      });

      describe('delete', () => {
        it('success', async () => {
          const [target, ...rest] = items;
          await repository.delete(target);
          await expectDb(rest);
        });

        it('if not exists', async () => {
          await repository.delete(params.notExistDocId());
          await expectDb(items);
        });
      });

      describe('batchSet', () => {
        it('empty', async () => {
          await repository.batchSet([]);
          await expectDb(items);
        });
        it('multi', async () => {
          const [target, ...rest] = items;
          const updatedItem = params.mutate(target);
          const newItem = params.newData();
          await repository.batchSet([newItem, updatedItem]);
          await expectDb([updatedItem, newItem, ...rest]);
        });
      });

      describe('batchDelete', () => {
        it('empty', async () => {
          await repository.batchDelete([]);
        });
        it('multi', async () => {
          const [target, ...rest] = items;
          await repository.batchDelete([target, params.notExistDocId()]);
          await expectDb(rest);
        });
      });

      if (environment.implementationSpecificTests) {
        describe('implementation-specific tests', () => {
          environment.implementationSpecificTests?.(params, setup);
        });
      }
    });
  };

  describe('repository specifications', () => {
    defineTests({
      title: 'root collection',
      collection: authorsCollection,
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
      sortKey: (a) => a.authorId,
    });

    defineTests({
      title: 'subcollection',
      collection: postsCollection,
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
      sortKey: ({ postId, authorId }) => `${postId}-${authorId}`,
    });
  });
};

export type TestCollectionParams<T extends CollectionSchema = CollectionSchema> = {
  title: string;
  collection: T;
  newData: () => Model<T>;
  mutate: (data: Model<T>) => Model<T>;
  notExistDocId: () => Id<T>;
  sortKey: (id: Id<T>) => string;
};

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
