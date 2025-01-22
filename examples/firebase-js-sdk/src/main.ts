import { initializeApp } from '@firebase/app';
import { connectFirestoreEmulator, getFirestore } from '@firebase/firestore';
import { Repository } from '@firestore-repository/firebase-js-sdk';
import type { Timestamp } from 'firestore-repository/document';
import { condition as $, limit, query, where } from 'firestore-repository/query';
import { implicit, mapTo, rootCollection } from 'firestore-repository/schema';

async function main() {
  const db = getFirestore(
    initializeApp({ projectId: 'firestore-repository-dummy-project' }),
    'example-firebase-js-sdk',
  );
  connectFirestoreEmulator(db, 'localhost', 60001);

  const repository = new Repository(authors, db);

  await repository.set({
    authorId: 'author1',
    name: 'John Doe',
    profile: {
      age: 42,
      gender: 'male',
    },
    tag: ['new'],
    registeredAt: new Date(),
  });

  const doc = await repository.get({ authorId: 'author1' });
  console.log(doc);

  const docs = await repository.list(query(authors, where($('profile.age', '>=', 20)), limit(10)));
  console.log(docs);

  repository.listOnSnapshot(
    query(authors, where($('tag', 'array-contains', 'new')), limit(10)),
    (docs) => {
      console.log(docs);
    },
  );
}

const authors = rootCollection({
  name: 'Authors',
  id: mapTo('authorId'),
  data: implicit(
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
