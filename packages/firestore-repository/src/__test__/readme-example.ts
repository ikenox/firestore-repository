import { describe, it } from 'vitest';

import { average, count, sum } from '../aggregate.js';
import { condition as $, limit, query } from '../query.js';
import type { FirestoreEnvironment, PlainRepository } from '../repository.js';
import { type Collection, rootCollection, schemaWithoutValidation } from '../schema.js';

export const defineReadmeExampleTests = <Env extends FirestoreEnvironment>({
  db,
  createRepository,
}: {
  createRepository: <T extends Collection>(collection: T) => PlainRepository<T, Env>;
  db: {
    writeBatch: () => Env['writeBatch'] & { commit(): Promise<unknown> };
    transaction: <T>(runner: (tx: Env['transaction']) => Promise<T>) => Promise<T>;
  };
}) => {
  describe('example code for README.md', () => {
    const console = {
      log: (_arg: unknown) => {
        /*no-op*/
      },
    };

    // define a collection
    const users = rootCollection({
      name: 'Authors',
      data: schemaWithoutValidation<{
        name: string;
        profile: { age: number; gender?: 'male' | 'female' };
        tag: string[];
      }>(),
    });

    const repository = createRepository(users);

    it('basic usage', async () => {
      // set
      await repository.set({
        ref: ['user1'],
        data: { name: 'John Doe', profile: { age: 42, gender: 'male' }, tag: ['new'] },
      });

      // get
      const doc = await repository.get(['user1']);
      console.log(doc);

      // delete
      await repository.delete(['user2']);

      // query
      const q = query(
        { collection: users },
        $('profile.age', '>=', 20),
        $('profile.gender', '==', 'male'),
        limit(10),
      );
      const docs = await repository.list(q);
      console.log(docs);

      // listen document
      repository.getOnSnapshot(['user1'], (doc) => {
        console.log(doc);
      });

      // listen query
      repository.listOnSnapshot(q, (docs) => {
        console.log(docs);
      });

      // aggregate
      const result = await repository.aggregate(q, {
        avgAge: average('profile.age'),
        sumAge: sum('profile.age'),
        count: count(),
      });
      console.log(`avg:${result.avgAge} sum:${result.sumAge} count:${result.count}`);
    });

    it('batch operation', async () => {
      // set
      await repository.batchSet([
        {
          ref: ['user1'],
          data: { name: 'Alice', profile: { age: 30, gender: 'female' }, tag: ['new'] },
        },
        { ref: ['user2'], data: { name: 'Bob', profile: { age: 20, gender: 'male' }, tag: [] } },
      ]);

      // delete
      await repository.batchDelete([['user1'], ['user2']]);

      // mix multiple operations
      const batch = db.writeBatch();
      await repository.set(
        { ref: ['user3'], data: { name: 'Bob', profile: { age: 20, gender: 'male' }, tag: [] } },
        { tx: batch },
      );
      await repository.batchSet(
        [
          // ...
        ],
        { tx: batch },
      );
      await repository.delete(['user4'], { tx: batch });
      await repository.batchDelete([['user5'], ['user6']], { tx: batch });
      await batch.commit();
    });

    it('transaction', async () => {
      await db.transaction(async (tx) => {
        // get
        const doc = await repository.get(['user1'], { tx });

        if (doc) {
          doc.data.tag = [...doc.data.tag, 'new-tag'];
          // set
          await repository.set(doc, { tx });
          await repository.batchSet(
            [
              { ...doc, ref: ['user2'] },
              { ...doc, ref: ['user3'] },
            ],
            { tx },
          );
        }

        // delete
        await repository.delete(['user4'], { tx });
        await repository.batchDelete([['user5'], ['user6']], { tx });
      });
    });
  });
};
