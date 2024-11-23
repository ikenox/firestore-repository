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
    from: {
      data: (data: { name: string; registeredAt: Timestamp }) => data,
      id: (authorId) => ({ authorId }),
    },
    to: {
      data: (data) => data,
      id: ({ authorId }) => [authorId],
    },
  });

  const posts = collection({
    name: 'Posts',
    from: {
      data: (data: { title: string; postedAt: Timestamp }) => ({
        ...data,
      }),
      id: (postId) => ({ postId }),
    },
    to: {
      data: (data) => ({
        ...data,
      }),
      id: ({ postId, authorId }) => [postId, { authorId }],
    },
    parent: authors,
  });

  class AuthorRepository extends Repository<typeof authors> {}

  const repo = new AuthorRepository(authors, db);
  const author1 = await repo.get({ authorId: 'author1' });
});
