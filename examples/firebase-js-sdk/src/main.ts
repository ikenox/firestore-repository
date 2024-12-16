import { initializeApp } from '@firebase/app';
import { connectFirestoreEmulator, getFirestore } from '@firebase/firestore';
import { Repository } from '@firestore-repository/firebase-js-sdk';
import { collection, id } from 'firestore-repository/schema';

async function main() {
  const db = getFirestore(initializeApp({ projectId: 'dummy-project' }), 'example-firebase-js-sdk');
  connectFirestoreEmulator(db, 'localhost', 60001);

  const testCollection = collection({
    name: 'TestCollection',
    data: {
      from: (data: {
        id: string;
        value: number;
      }) => data,
      to: (data) => data,
    },
    id: id('id'),
  });
  const repository = new Repository(testCollection, db);

  await repository.set({ id: 'test', value: 123 });
  const doc = await repository.get({ id: 'test' });
  // biome-ignore lint/suspicious/noConsole: <explanation>
  console.info(doc);
}

// biome-ignore lint/complexity/noVoid: <explanation>
void main().then(() => process.exit(0));
