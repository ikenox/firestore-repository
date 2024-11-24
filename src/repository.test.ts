import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { Timestamp, collection } from './index.js';
import { Repository } from './repository.js';

describe('test', async () => {
  const db = getFirestore(
    admin.initializeApp({
      projectId: 'dummy-project',
    }),
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
        registeredAt: data.registeredAt.toDate(),
      }),
      to: ({ name, registeredAt }) => ({
        name,
        registeredAt: Timestamp.fromDate(),
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

  it('get and set', async () => {
    const data: Author = {
      authorId: '123',
      name: 'author1',
      registeredAt: new Timestamp(),
    };
    const author = await authorRepository.get({ authorId: '123' });
    expect(author).toBeUndefined();
    authorRepository.set({
      authorId: '123',
    });
  });
});
