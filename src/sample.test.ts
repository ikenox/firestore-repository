import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { describe, it } from 'vitest';
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
      from: (data: { name: string; registeredAt: Timestamp }) => data,
      to: (data) => data,
    },
  });

  const posts = collection({
    name: 'Posts',
    id: {
      from: (postId) => ({ postId }),
      to: ({ postId }) => postId,
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

  class AuthorRepository extends Repository<typeof authors> {}
  class PostsRepository extends Repository<typeof posts> {}

  const authorRepository = new AuthorRepository(authors, db);
  const postsRepository = new PostsRepository(posts, db);
});
