import { beforeAll, describe, expect, it } from 'vitest';
import { CollectionSchema, Repository, Timestamp, as, collection } from '../index.js';
import { deleteAll, randomNumber } from './util.js';

/**
 * List of specifications that repository implementations must satisfy
 */
export const defineRepositorySpecificationTests = (
  repository: <T extends CollectionSchema>(collection: T) => Repository<T>,
  environment: {
    converters: {
      timestamp: (date: Date) => Timestamp;
    };
    implementationSpecificTests?: <T extends Repository>(params: TestCollectionParams<T>) => void;
  },
) => {
  const converters = environment.converters;

  const defineTests = <T extends Repository>(params: TestCollectionParams<T>) => {
    const repository = params.repository;

    describe(params.title, async () => {
      const setup = () =>
        beforeAll(async () => {
          await deleteAll(repository, {});
          await repository.batchSet(params.initial);
        });

      const dataList = params.initial;

      describe('get', () => {
        setup();
        it('exists', async () => {
          const dataFromDb = await repository.get(dataList[0]);
          expect(dataFromDb).toStrictEqual(dataList[0]);
        });
        it('not found', async () => {
          expect(await repository.get(params.notExistDocId())).toBeUndefined();
        });
      });

      describe('set', () => {
        setup();
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
        setup();
        it('precondition', async () => {
          expect(await repository.get(dataList[0])).toBeTruthy();
        });
        it('success', async () => {
          await repository.delete(dataList[0]);
          expect(await repository.get(dataList[0])).toBeUndefined();
        });
        it('if not exists', async () => {
          await repository.delete(dataList[0]);
          expect(await repository.get(dataList[0])).toBeUndefined();
        });
      });

      if (environment.implementationSpecificTests) {
        describe('implementation specific tests', () => {
          environment.implementationSpecificTests?.(params);
        });
      }
    });
  };

  describe('repository specifications', () => {
    defineTests({
      title: 'root collection',
      repository: repository(authorsCollection),
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
      repository: repository(postsCollection),
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

export type TestCollectionParams<T extends Repository> = {
  title: string;
  repository: T;
  initial: [T['collection']['$model'], T['collection']['$model'], T['collection']['$model']];
  newData: () => T['collection']['$model'];
  mutate: (data: T['collection']['$model']) => T['collection']['$model'];
  notExistDocId: () => T['collection']['$id'];
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
