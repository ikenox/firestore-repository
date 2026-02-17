import { initializeApp } from '@firebase/app';
import {
  connectFirestoreEmulator,
  Timestamp as FirebaseTimestamp,
  getFirestore,
} from '@firebase/firestore';
import { newRootCollectionRepository } from '@firestore-repository/firebase-js-sdk';
import { wrap } from '@firestore-repository/firebase-js-sdk/value';
import type { Timestamp } from 'firestore-repository/document';
import { condition as $, limit, query } from 'firestore-repository/query';
import { rootCollection } from 'firestore-repository/schema';

async function main() {
  const db = getFirestore(
    initializeApp({ projectId: 'firestore-repository-dummy-project' }),
    'example-firebase-js-sdk',
  );
  connectFirestoreEmulator(db, 'localhost', 60001);

  const repository = newRootCollectionRepository(db, authors);

  await repository.set({
    ref: 'author1',
    data: {
      name: 'John Doe',
      profile: { age: 42, gender: 'male' },
      tag: ['new'],
      registeredAt: wrap(FirebaseTimestamp.fromDate(new Date())),
    },
  });

  const doc = await repository.get('author1');
  console.log(doc);

  const docs = (
    await repository.list(query({ collection: authors }, $('profile.age', '>=', 20), limit(10)))
  ).toArray();
  console.log(docs);

  repository.listOnSnapshot(
    query({ collection: authors }, $('tag', 'array-contains', 'new'), limit(10)),
    (docs) => {
      console.log(docs);
    },
  );
}

type AuthorData = {
  name: string;
  profile: { age: number; gender?: 'male' | 'female' };
  tag: string[];
  registeredAt: Timestamp;
};

const authors = rootCollection({
  name: 'Authors',
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- example code for demonstration
  data: { validate: (data): AuthorData => data as unknown as AuthorData },
});

void main().then(() => process.exit(0));
