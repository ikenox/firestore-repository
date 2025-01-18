import { Repository } from '@firestore-repository/google-cloud-firestore';
import { Firestore, type Timestamp } from '@google-cloud/firestore';
import { id, implicit, rootCollection } from 'firestore-repository/schema';

async function main() {
  process.env['FIRESTORE_EMULATOR_HOST'] = 'localhost:60001';
  const db = new Firestore({
    projectId: 'firestore-repository-dummy-project',
    databaseId: 'example-google-cloud-firestore',
  });

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

// biome-ignore lint/complexity/noVoid: <explanation>
void main().then(() => process.exit(0));
