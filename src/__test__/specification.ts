import { Timestamp as AdminTimestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { CollectionSchema, Repository, Timestamp, as, collection } from '../index.js';

/**
 * List of specifications that repository implementations must satisfy
 */

export const defineRepositorySpecificationTests = <T extends Repository>(
  repository: <const T extends CollectionSchema>(collection: T) => Repository<T>,
) => {
  const authorRepository = repository(authorsCollection);
  const postsRepository = repository(postsCollection);
  allMethodsTests(authorRepository, {
    initial: [
      {
        authorId: 'author0',
        name: 'name0',
        registeredAt: AdminTimestamp.fromDate(new Date()),
      },
      {
        authorId: 'author1',
        name: 'name1',
        registeredAt: AdminTimestamp.fromDate(new Date()),
      },
      {
        authorId: 'author2',
        name: 'name2',
        registeredAt: AdminTimestamp.fromDate(new Date()),
      },
    ],
    newData: () => ({
      authorId: `author_${crypto.randomUUID()}`,
      name: `name_${crypto.randomUUID()}`,
      registeredAt: AdminTimestamp.fromDate(new Date()),
    }),
    mutate: (data) => ({
      ...data,
      name: `${data.name}_updated`,
    }),
  });
};

export const allMethodsTests = <T extends Repository>(
  repository: T,
  params: {
    initial: [T['collection']['$model'], T['collection']['$model'], T['collection']['$model']];
    newData: () => T['collection']['$model'];
    mutate: (data: T['collection']['$model']) => T['collection']['$model'];
  },
) => {
  describe('repository specifications', async () => {
    beforeEach(async () => {
      await deleteAll(repository, {});
      await repository.batchSet(params.initial);
    });

    const dataList = params.initial;

    describe('get', () => {
      it('exists', async () => {
        const dataFromDb = await repository.get(dataList[0]);
        expect(dataFromDb).toStrictEqual(dataList[0]);
      });
      it('not found', async () => {
        expect(await repository.get({ authorId: 'other-author-id' })).toBeUndefined();
      });
    });

    describe('set', () => {
      const newData = params.newData();

      it('create', async () => {
        await repository.set(newData);
        // TODO assertion
      });
      it('update', async () => {
        const updated = params.mutate(newData);
        await repository.set(updated);
        // TODO assertion
      });
    });

    describe('create', () => {
      const newData = params.newData();

      it('precondition', async () => {
        expect(await repository.get(newData)).toBeUndefined();
      });
      it('success', async () => {
        await repository.create(newData);
        const dataFromDb = await repository.get(newData);
        expect(dataFromDb).toStrictEqual<typeof dataFromDb>(newData);
      });
      it('already exists', async () => {
        await expect(repository.create(newData)).rejects.toThrowError(/ALREADY_EXISTS/);
      });
    });

    describe('delete', () => {
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

    describe('batchGet', () => {
      it('empty', async () => {
        expect(await repository.batchGet([])).toStrictEqual([]);
      });
      it('not empty', async () => {
        expect(
          await repository.batchGet([
            dataList[0],
            dataList[2],
            dataList[1],
            { authorId: 'other-author-id' },
            dataList[2],
          ]),
        ).toStrictEqual([dataList[0], dataList[2], dataList[1], undefined, dataList[2]]);
      });
    });
  });
};

const deleteAll = <T extends Repository>(repository: T, parentId: T['collection']['$parentId']) =>
  repository.query(parentId).then((docs) => repository.batchDelete(docs));

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
      to: ({ authorId }) => ({ authorId }),
    },
  },
  data: {
    from: (data: { title: string; postedAt: Timestamp }) => ({
      ...data,
    }),
    to: (data) => ({ ...data }),
  },
});
