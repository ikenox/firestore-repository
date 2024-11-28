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
      setupRepository: () => Promise<Repo>,
    ) => void;
  },
) => {
  const converters = environment.converters;

  const defineTests = <T extends CollectionSchema>(params: TestCollectionParams<T>) => {
    const setupRepository = async (): Promise<Repo> => {
      const repo = repository({
        ...params.collection,
        // use unique collection for each test
        name: `${params.collection.name}_${randomString()}`,
      });
      // setup initial data
      await repo.batchSet(params.initial);
      return repo;
    };

    describe(params.title, async () => {
      let repository!: Repo;
      beforeEach(async () => {
        repository = await setupRepository();
      });

      const items = params.initial;

      describe('get', () => {
        it('exists', async () => {
          const dataFromDb = await repository.get(items[0]);
          expect(dataFromDb).toStrictEqual(items[0]);
        });

        it('not found', async () => {
          expect(await repository.get(params.notExistDocId())).toBeUndefined();
        });
      });

      describe('set', () => {
        const newData = params.newData();

        it('create', async () => {
          await repository.set(newData);
          // TODO assertion
          expect(await repository.get(newData)).toStrictEqual(newData);
        });

        it('update', async () => {
          const updated = params.mutate(newData);
          await repository.set(updated);
          // TODO assertion
          expect(await repository.get(newData)).toStrictEqual(updated);
        });
      });

      describe('delete', () => {
        it('success', async () => {
          await repository.delete(items[0]);
          expect(await repository.get(items[0])).toBeUndefined();
        });

        it('if not exists', async () => {
          await repository.delete(items[0]);
          expect(await repository.get(items[0])).toBeUndefined();
          await repository.delete(items[0]);
          expect(await repository.get(items[0])).toBeUndefined();
        });
      });

      describe('batchSet', () => {
        it('empty', async () => {
          await repository.batchSet([]);
        });
        it('multi', async () => {
          const newItem = params.newData();
          const updatedItem = params.mutate(items[0]);
          expect(await repository.get(newItem)).toBeUndefined();
          expect(await repository.get(updatedItem)).toStrictEqual(items[0]);
          await repository.batchSet([newItem, updatedItem]);
          expect(await repository.get(newItem)).toStrictEqual(newItem);
          expect(await repository.get(updatedItem)).toStrictEqual(updatedItem);
        });
      });

      describe('batchDelete', () => {
        it('empty', async () => {
          await repository.batchDelete([]);
        });
        it('multi', async () => {
          items;
        });
      });

      if (environment.implementationSpecificTests) {
        describe('implementation-specific tests', () => {
          environment.implementationSpecificTests?.(params, setupRepository);
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
  initial: [Model<T>, Model<T>, Model<T>];
  newData: () => Model<T>;
  mutate: (data: Model<T>) => Model<T>;
  notExistDocId: () => Id<T>;
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
