import { Repository } from '@firestore-repository/google-cloud-firestore';
import { Firestore } from '@google-cloud/firestore';
import { coercible, collection, id, rootCollectionPath } from 'firestore-repository/schema';

async function main() {
  process.env['FIRESTORE_EMULATOR_HOST'] = 'localhost:60001';
  const db = new Firestore({
    projectId: 'firestore-repository-dummy-project',
    databaseId: 'example-google-cloud-firestore',
  });
  const testCollection = collection({
    name: 'TestCollection',
    data: coercible((data: { value: number }) => data),
    id: id('id'),
    collectionPath: rootCollectionPath,
  });
  const repository = new Repository(testCollection, db);

  await repository.set({ id: 'test', value: 123 });
  const doc = await repository.get({ id: 'test' });
  // biome-ignore lint/suspicious/noConsole: <explanation>
  console.info(doc);
}

// biome-ignore lint/complexity/noVoid: <explanation>
void main().then(() => process.exit(0));
