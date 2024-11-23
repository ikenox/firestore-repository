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
    fromFirestore: (data: { name: string; registeredAt: Timestamp }, id: string) => ({
      authorId: id,
      ...data,
    }),
    toFirestore: (data) => data,
    id: {
      keys: ['authorId'],
      serialize: ({ authorId }) => authorId,
    },
  });

  const posts = collection({
    name: 'Posts',
    fromFirestore: (
      data: { title: string; postedAt: Timestamp },
      id: string,
      [authorId]: string[],
    ) => ({
      postId: id,
      authorId: authorId,
      ...data,
    }),
    toFirestore: (data) => data,
    id: {
      keys: ['postId'],
      serialize: ({ postId }) => postId,
    },
    parent: {
      keys: ['authorId'],
      path: ({ authorId }) => `${authors.name}/${authorId}`,
    },
  });

  class AuthorRepository extends Repository<typeof authors> {}

  const repo = new AuthorRepository(authors, db);
  const author1 = await repo.get({ authorId: 'author1' });
});
