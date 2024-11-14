import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { it } from 'vitest';

it('test', async () => {
  const db = getFirestore(
    admin.initializeApp({
      projectId: 'dummy-project',
    }),
  );
  await db.collection('testCollection').doc('hoge').set({ foo: 123 });
  const res = await db.collection('testCollection').get();
  console.log(res.docs.map((d) => d.data()));
});
