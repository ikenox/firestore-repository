import admin from 'firebase-admin';
import { Timestamp as AdminTimestamp, getFirestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { Timestamp, collection } from './index.js';
import { IdGenerator, Repository } from './repository.js';

describe('test', async () => {
  const db = getFirestore(
    admin.initializeApp({ projectId: process.env['TEST_PROJECT']! }),
    process.env['TEST_DB']!,
  );

  const authors = collection({
    name: 'Authors',
    id: {
      from: (authorId) => ({ authorId }),
      to: ({ authorId }) => authorId,
    },
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

  const posts = collection({
    name: 'Posts',
    id: {
      from: (postId) => ({ postId: Number(postId) }),
      to: ({ postId }) => postId.toString(),
    },
    parent: {
      schema: authors,
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

  type AuthorsCollection = typeof authors;
  type Author = AuthorsCollection['$model'];

  type PostsCollection = typeof posts;
  type Posts = PostsCollection['$model'];

  class AuthorRepository extends Repository<AuthorsCollection> {}
  class PostsRepository extends Repository<PostsCollection> {}

  const authorRepository = new AuthorRepository(authors, db);
  const postsRepository = new PostsRepository(posts, db);

  const idGenerator = new IdGenerator(db);

  it('get/set', async () => {
    const data: Author = {
      authorId: idGenerator.generate(),
      name: 'author1',
      registeredAt: AdminTimestamp.fromDate(new Date()),
    };
    const id = { authorId: data.authorId };

    {
      const author = await authorRepository.get(id);
      expect(author).toBeUndefined();
    }
    {
      // create
      await authorRepository.set(data);
      const author = await authorRepository.get(id);
      expect(author).toStrictEqual<typeof author>(data);
    }
    {
      // update
      const updated: Author = {
        ...data,
        name: 'author1_updated',
      };
      await authorRepository.set(updated);
      const author = await authorRepository.get(id);
      expect(author).toStrictEqual<typeof author>(updated);
    }
  });

  it('create', async () => {
    const data: Author = {
      authorId: idGenerator.generate(),
      name: 'author1',
      registeredAt: AdminTimestamp.fromDate(new Date()),
    };

    {
      const author = await authorRepository.get({ authorId: data.authorId });
      expect(author).toBeUndefined();
    }
    {
      await authorRepository.create(data);
      const author = await authorRepository.get({ authorId: data.authorId });
      expect(author).toStrictEqual<typeof author>(data);
    }
    {
      // already exists
      await expect(authorRepository.create(data)).rejects.toThrowError(/ALREADY_EXISTS/);
    }
  });

  it('delete', async () => {
    const data: Author = {
      authorId: idGenerator.generate(),
      name: 'author1',
      registeredAt: AdminTimestamp.fromDate(new Date()),
    };

    await authorRepository.create(data);
    expect(await authorRepository.get({ authorId: data.authorId })).toBeTruthy();

    await authorRepository.delete(data);
    expect(await authorRepository.get({ authorId: data.authorId })).toBeUndefined();
    // check idempotency
    await authorRepository.delete(data);
    expect(await authorRepository.get({ authorId: data.authorId })).toBeUndefined();
  });
});
