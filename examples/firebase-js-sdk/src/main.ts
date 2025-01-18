import { initializeApp } from '@firebase/app';
import { connectFirestoreEmulator, getFirestore } from '@firebase/firestore';
import { Repository } from '@firestore-repository/firebase-js-sdk';
import type { Timestamp } from 'firestore-repository/document';
import { coercible, id, rootCollection } from 'firestore-repository/schema';

async function main() {
  const db = getFirestore(
    initializeApp({ projectId: 'firestore-repository-dummy-project' }),
    'example-firebase-js-sdk',
  );
  connectFirestoreEmulator(db, 'localhost', 60001);

  const repository = new Repository(authors, db);

  await repository.set({
    id: 'author1',
    name: 'John Doe',
    profile: {
      age: 42,
      gender: 'male',
    },
    tag: ['new'],
    registeredAt: new Date(),
  });

  const doc = await repository.get({ id: 'author1' });
  // biome-ignore lint/suspicious/noConsole:
  console.info(doc);
}

const authors = rootCollection({
  name: 'Authors',
  id: id('id'),
  data: coercible(
    (data: {
      name: string;
      profile: {
        age: number;
        gender?: 'male' | 'female';
      };
      tag: string[];
      registeredAt: Timestamp;
    }) => ({
      ...data,
      registeredAt: data.registeredAt.toDate(),
    }),
  ),
});

// biome-ignore lint/complexity/noVoid:
void main().then(() => process.exit(0));
