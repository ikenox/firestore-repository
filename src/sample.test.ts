import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { it } from 'vitest';

it('test', async () => {
  const db = getFirestore(
    admin.initializeApp({
      projectId: 'dummy-project',
    }),
  );
  // const doc = await db.collection('testCollection').doc('hoge').get();
  // const res = await db
  //   .collection('testCollection')
  //   .where('map', 'array-contains', { aaaa: '123' })
  //   .get();
  const collection = db.collection('hoge');
  const doc = collection.doc();
  await doc.set({ a: { b: { c: 123 } } });
  console.log(await doc.get().then((d) => d.data()));

  await doc.update({ a: { b: { d: 123 } } }, { exists: false });
  console.log(await doc.get().then((d) => d.data()));
});
