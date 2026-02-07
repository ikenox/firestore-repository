import { newRootCollectionRepository } from '@firestore-repository/google-cloud-firestore';
import { Firestore } from '@google-cloud/firestore';
import { condition as $, limit, query } from 'firestore-repository/query';
import { rootCollection } from 'firestore-repository/schema';

async function main() {
  process.env['FIRESTORE_EMULATOR_HOST'] = 'localhost:60001';
  const db = new Firestore({
    projectId: 'firestore-repository-dummy-project',
    databaseId: 'example-google-cloud-firestore',
  });

  const repository = newRootCollectionRepository(db, authors);

  await repository.set({
    ref: ['author1'],
    data: { name: 'John Doe', profile: { age: 42, gender: 'male' }, tag: ['new'] },
  });

  const doc = await repository.get('author1');
  console.log(doc);

  const docs = await repository.list(
    query({ collection: authors }, $('profile.age', '>=', 20), limit(10)),
  );
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
};

const authors = rootCollection({
  name: 'Authors',
  // biome-ignore lint/plugin/no-type-assertion: example code for demonstration
  data: { validate: (data): AuthorData => data as unknown as AuthorData },
});

void main().then(() => process.exit(0));
