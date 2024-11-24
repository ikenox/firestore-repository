import { Timestamp as AdminTimestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { CollectionSchema, Repository, Timestamp, as, collection } from '../index.js';

/**
 * List of specifications that repository implementations must satisfy
 */

export const defineRepositorySpecificationTests = <T extends Repository>(
  repository: <const T extends CollectionSchema>(collection: T) => Repository<T>,
) => {
  type AuthorsCollection = typeof authorsCollection;
  type Author = AuthorsCollection['$model'];

  type PostsCollection = typeof postsCollection;
  type Posts = PostsCollection['$model'];

  const authorRepository = repository(authorsCollection);
  const postsRepository = repository(postsCollection);

  describe('repository specifications', async () => {
    const authors = [
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
    ] as const satisfies Author[];

    const deleteAll = <T extends Repository>(
      repository: T,
      parentId: T['collection']['$parentId'],
    ) => repository.query(parentId).then((docs) => repository.batchDelete(docs));

    beforeEach(async () => {
      await deleteAll(authorRepository, {});
      await authorRepository.batchSet(authors);
    });

    it('get', async () => {
      const author0 = await authorRepository.get({ authorId: authors[0].authorId });
      expect(author0).toStrictEqual(authors[0]);
      expect(await authorRepository.get({ authorId: 'other-author-id' })).toBeUndefined();

      // get by entire document
      expect(await authorRepository.get(authors[0])).toStrictEqual(authors[0]);
    });

    it('set', async () => {
      const newAuthor: Author = {
        authorId: 'author100',
        name: 'name100',
        registeredAt: AdminTimestamp.fromDate(new Date()),
      };

      // create
      await authorRepository.set(newAuthor);

      // TODO assertion

      // update
      const updated: Author = {
        ...newAuthor,
        name: 'name100_updated',
      };
      await authorRepository.set(updated);

      // TODO assertion
    });

    it('create', async () => {
      const newAuthor: Author = {
        authorId: 'author100',
        name: 'name100',
        registeredAt: AdminTimestamp.fromDate(new Date()),
      };

      expect(await authorRepository.get({ authorId: newAuthor.authorId })).toBeUndefined();

      await authorRepository.create(newAuthor);
      const author = await authorRepository.get({ authorId: newAuthor.authorId });
      expect(author).toStrictEqual<typeof author>(newAuthor);

      // already exists
      await expect(authorRepository.create(newAuthor)).rejects.toThrowError(/ALREADY_EXISTS/);
    });

    it('delete', async () => {
      const id0 = { authorId: authors[0].authorId };
      // delete
      await authorRepository.delete(id0);
      expect(await authorRepository.get(id0)).toBeUndefined();
      // check idempotency
      await authorRepository.delete(id0);
      expect(await authorRepository.get(id0)).toBeUndefined();
    });

    it('batchGet', async () => {
      expect(await authorRepository.batchGet([])).toStrictEqual([]);

      expect(
        await authorRepository.batchGet([
          { authorId: authors[0].authorId },
          { authorId: authors[2].authorId },
          { authorId: authors[1].authorId },
          { authorId: 'other-author-id' },
          { authorId: authors[2].authorId },
        ]),
      ).toStrictEqual([authors[0], authors[2], authors[1], undefined, authors[2]]);
    });
  });
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
    from: ({ authorId }) => ({ authorId }),
    to: ({ authorId }) => ({ authorId }),
  },
  data: {
    from: (data: { title: string; postedAt: Timestamp }) => ({
      ...data,
    }),
    to: (data) => ({ ...data }),
  },
});
