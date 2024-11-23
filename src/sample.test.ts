import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { it } from 'vitest';
import { Repository } from './repository.js';
import { Timestamp, collection } from './types.js';

it('test', async () => {
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
      to: ({ postId, authorId }) => postId,
    },
    data: {
      from: (data: { title: string; postedAt: Timestamp }) => ({
        ...data,
      }),
      to: (data) => ({ ...data }),
    },
    parent: {
      schema: authors,
      from: ({ authorId }) => ({ authorId }),
      to: ({ authorId }) => ({ authorId }),
    },
  });

  class AuthorRepository extends Repository<typeof authors> {}

  const repo = new AuthorRepository(authors, db);
  const author1 = await repo.get({ authorId: 'author1' });
});
