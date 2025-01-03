import { assert, beforeAll, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { average, count, sum } from '../aggregate.js';
import type {
  Bytes,
  DocumentReference,
  FieldPath,
  GeoPoint,
  Timestamp,
  VectorValue,
} from '../document.js';
import {
  condition as $,
  type Query,
  and,
  collectionGroupQuery,
  endAt,
  endBefore,
  limit,
  limitToLast,
  or,
  orderBy,
  query,
  startAfter,
  startAt,
  where,
} from '../query.js';
import type { FirestoreEnvironment, Repository } from '../repository.js';
import {
  type CollectionSchema,
  type DbModel,
  type Id,
  type Model,
  coercible,
  collection,
  id,
  numberId,
  rootCollectionPath,
  subCollectionPath,
} from '../schema.js';
import {
  expectArrayEqualsWithoutOrder,
  randomNumber,
  randomString,
  sleep,
  uniqueCollection,
} from './util.js';

// root collection
export const authorsCollection = collection({
  name: 'Authors',
  data: coercible(
    (data: {
      name: string;
      profile: {
        age: number;
        gender?: 'male' | 'female';
      };
      rank: number;
      registeredAt: Timestamp;
    }) => ({
      ...data,
      registeredAt: data.registeredAt.toDate(),
    }),
  ),
  id: id('authorId'),
  collectionPath: rootCollectionPath,
});

// subcollection
export const postsCollection = collection({
  name: 'Posts',
  data: coercible(
    (data: {
      authorId: string;
      title: string;
      postedAt: Timestamp;
    }) => ({
      ...data,
      postedAt: data.postedAt.toDate(),
    }),
  ),
  id: numberId('postId'),
  collectionPath: subCollectionPath(authorsCollection),
});

/**
 * List of specifications that repository implementations must satisfy
 */
export const defineRepositorySpecificationTests = <Env extends FirestoreEnvironment>({
  db,
  createRepository,
  types,
  implementationSpecificTests,
}: {
  createRepository: <T extends CollectionSchema>(collection: T) => Repository<T, Env>;
  db: {
    writeBatch: () => Env['writeBatch'] & { commit(): Promise<unknown> };
    transaction: <T>(runner: (tx: Env['transaction']) => Promise<T>) => Promise<T>;
  };
  types: {
    timestamp: (date: Date) => Timestamp;
    geoPoint: (latitude: number, longitude: number) => GeoPoint;
    bytes: (value: number[]) => Bytes;
    vector: (values: number[]) => VectorValue;
    documentReference: (path: string) => DocumentReference;
  };
  implementationSpecificTests?: <T extends CollectionSchema>(
    params: TestCollectionParams<T>,
    setup: () => RepositoryTestEnv<T, Env>,
  ) => void;
}) => {
  const defineTests = <T extends CollectionSchema>(params: TestCollectionParams<T>) => {
    const setup = (): RepositoryTestEnv<T, Env> => {
      const items = [params.newData(), params.newData(), params.newData()] as [
        Model<T>,
        Model<T>,
        Model<T>,
      ];

      const repository = createRepository(params.collection);
      beforeEach(async () => {
        // use unique dedicated collection for each tests
        repository.collection = uniqueCollection(params.collection);
        await repository.batchSet(items);
      });

      return {
        repository,
        items,
        expectDb: async (expected: Model<T>[]) => {
          const items = (await repository.list(
            collectionGroupQuery(repository.collection),
          )) as Model<T>[];
          // biome-ignore lint/suspicious/noMisplacedAssertion:
          expect(
            items.toSorted((a, b) => params.sortKey(a).localeCompare(params.sortKey(b))),
          ).toStrictEqual(
            expected.toSorted((a, b) => params.sortKey(a).localeCompare(params.sortKey(b))),
          );
        },
      };
    };

    describe(params.title, async () => {
      const { repository, items, expectDb } = setup();

      describe('get', () => {
        it('exists', async () => {
          expect(await repository.get(items[0])).toStrictEqual(items[0]);
        });

        it('not found', async () => {
          expect(await repository.get(params.notExistDocId())).toBeUndefined();
        });

        it('transaction', async () => {
          const res = await db.transaction(async (tx) => {
            const item0 = await repository.get(items[0], { tx });
            const item1 = await repository.get(items[1], { tx });
            return [item0, item1];
          });
          expect(res).toStrictEqual([items[0], items[1]]);
        });
      });

      it('getOnSnapshot', async () => {
        let finish: () => void;
        const finished = new Promise((resolve) => {
          finish = () => resolve(null);
        });

        const updated1 = params.mutate(items[0]);
        const updated2 = params.mutate(items[0]);
        const updated3 = params.mutate(items[0]);
        const operations: (() => Promise<void>)[] = [
          () => repository.set(updated1),
          () => repository.set(updated2),
          () => repository.delete(updated2),
          () => repository.set(updated3),
        ];

        const received: (Model<T> | undefined)[] = [];
        const unsubscribe = repository.getOnSnapshot(items[0], (snapshot) => {
          received.push(snapshot);
          const op = operations.shift();
          if (op) {
            op();
          } else {
            finish();
          }
        });

        await finished;

        unsubscribe();
        await repository.set(params.mutate(items[0]));
        // wait an update that occurs after unsubscribe
        await sleep(100);

        expect(received).toStrictEqual<typeof received>([
          items[0],
          updated1,
          updated2,
          undefined,
          updated3,
        ]);
      });

      it('list', async () => {
        const res = await repository.list(collectionGroupQuery(repository.collection));
        expectArrayEqualsWithoutOrder(res, items);
      });

      it('listOnSnapshot', async () => {
        let finish: () => void;
        const finished = new Promise((resolve) => {
          finish = () => resolve(null);
        });

        const updated0 = params.mutate(items[0]);
        const updated1 = params.mutate(items[1]);
        const newItem = params.newData();
        const operations: (() => Promise<void>)[] = [
          () => repository.set(newItem),
          () => repository.set(updated0),
          () => repository.set(updated1),
          () => repository.delete(updated1),
        ];

        const received: Model<T>[][] = [];
        const unsubscribe = repository.listOnSnapshot(
          collectionGroupQuery(repository.collection),
          (list) => {
            received.push(list);
            const op = operations.shift();
            if (op) {
              op();
            } else {
              finish();
            }
          },
        );

        await finished;

        unsubscribe();
        await repository.set(params.newData());
        // wait an update that occurs after unsubscribe
        await sleep(100);

        expect(received).toStrictEqual<typeof received>([
          items,
          [...items, newItem],
          [updated0, items[1], items[2], newItem],
          [updated0, updated1, items[2], newItem],
          [updated0, items[2], newItem],
        ]);
      });

      describe('set', () => {
        const newItem = params.newData();

        it('create', async () => {
          await repository.set(newItem);
          await expectDb([...items, newItem]);
        });

        it('update', async () => {
          const [target, ...rest] = items;
          const updated = params.mutate(target);
          await repository.set(updated);
          await expectDb([updated, ...rest]);
        });

        describe('transaction', () => {
          const updated0 = params.mutate(items[0]);
          const updated1 = params.mutate(items[1]);

          it('success', async () => {
            await db.transaction(async (tx) => {
              await repository.set(updated0, { tx });
              await repository.set(updated1, { tx });
            });
            await expectDb([updated0, updated1, items[2]]);
          });

          it('abort', async () => {
            const updated0 = params.mutate(items[0]);
            const promise = db.transaction(async (tx) => {
              await repository.set(updated0, { tx });
              await repository.set(updated1, { tx });
              throw new Error('abort');
            });
            await expect(promise).rejects.toThrowError('abort');
            await expectDb(items);
          });
        });

        it('writeBatch', async () => {
          const updated0 = params.mutate(items[0]);
          const updated1 = params.mutate(items[1]);

          const batch = db.writeBatch();
          await repository.set(updated0, { tx: batch });
          await repository.set(updated1, { tx: batch });
          await expectDb(items);
          await batch.commit();
          await expectDb([updated0, updated1, items[2]]);
        });
      });

      describe('batchSet', () => {
        const newItem = params.newData();
        const [target, ...rest] = items;
        const updated = params.mutate(target);

        it('success', async () => {
          await repository.batchSet([newItem, updated]);
          await expectDb([updated, newItem, ...rest]);
        });

        it('empty', async () => {
          await repository.batchSet([]);
          await expectDb(items);
        });

        describe('transaction', () => {
          it('success', async () => {
            await db.transaction(async (tx) => {
              await repository.batchSet([newItem, updated], { tx });
            });
            await expectDb([updated, newItem, ...rest]);
          });

          it('abort', async () => {
            const promise = db.transaction(async (tx) => {
              await repository.batchSet([newItem, updated], { tx });
              throw new Error('abort');
            });
            await expect(promise).rejects.toThrowError('abort');
            await expectDb(items);
          });
        });

        it('writeBatch', async () => {
          const updated0 = params.mutate(items[0]);
          const updated1 = params.mutate(items[1]);

          const batch = db.writeBatch();
          await repository.batchSet([updated0], { tx: batch });
          await repository.batchSet([updated1, newItem], { tx: batch });
          await expectDb(items);
          await batch.commit();
          await expectDb([updated0, updated1, items[2], newItem]);
        });
      });

      describe('delete', () => {
        it('success', async () => {
          const [target, ...rest] = items;
          await repository.delete(target);
          await expectDb(rest);
        });

        it('if not exists', async () => {
          await repository.delete(params.notExistDocId());
          await expectDb(items);
        });

        describe('transaction', () => {
          it('success', async () => {
            await db.transaction(async (tx) => {
              await repository.delete(items[0], { tx });
              await repository.delete(items[1], { tx });
            });
            await expectDb([items[2]]);
          });

          it('abort', async () => {
            const promise = db.transaction(async (tx) => {
              await repository.delete(items[0], { tx });
              await repository.delete(items[1], { tx });
              throw new Error('abort');
            });
            await expect(promise).rejects.toThrowError('abort');
            await expectDb(items);
          });
        });

        it('writeBatch', async () => {
          const batch = db.writeBatch();
          await repository.delete(items[0], { tx: batch });
          await repository.delete(items[1], { tx: batch });
          await expectDb(items);
          await batch.commit();
          await expectDb([items[2]]);
        });
      });

      describe('batchDelete', () => {
        const [target1, target2, ...rest] = items;

        it('empty', async () => {
          await repository.batchDelete([]);
        });

        it('multi', async () => {
          await repository.batchDelete([target1, target2, params.notExistDocId()]);
          await expectDb(rest);
        });

        describe('transaction', () => {
          it('success', async () => {
            await db.transaction(async (tx) => {
              await repository.batchDelete([target1, target2, params.notExistDocId()], { tx });
            });
            await expectDb(rest);
          });

          it('abort', async () => {
            const promise = db.transaction(async (tx) => {
              await repository.batchDelete([target1, target2, params.notExistDocId()], { tx });
              throw new Error('abort');
            });
            await expect(promise).rejects.toThrowError('abort');
            await expectDb(items);
          });
        });

        it('writeBatch', async () => {
          const batch = db.writeBatch();
          await repository.batchDelete([target1], { tx: batch });
          await repository.batchDelete([target2], { tx: batch });
          await expectDb(items);
          await batch.commit();
          await expectDb(rest);
        });
      });

      if (implementationSpecificTests) {
        describe('implementation-specific tests', () => {
          implementationSpecificTests?.(params, setup);
        });
      }
    });
  };

  describe('repository specifications', () => {
    let baseId = randomNumber();

    defineTests({
      title: 'root collection',
      collection: authorsCollection,
      newData: () => {
        const id = baseId++;
        return {
          authorId: `author${id}`,
          name: `name${id}`,
          profile: {
            age: randomNumber(),
            gender: 'male' as const,
          },
          rank: randomNumber(),
          registeredAt: new Date(),
        };
      },
      mutate: (data) => ({
        ...data,
        name: `${data.name}_updated_${randomString()}`,
      }),
      notExistDocId: () => ({ authorId: 'not-exists' }),
      sortKey: (a) => a.authorId,
    });

    defineTests({
      title: 'subcollection',
      collection: postsCollection,
      newData: () => {
        const id = baseId++;
        const authorId = baseId++;
        return {
          postId: id,
          title: `post${id}`,
          authorId: `author${authorId}`,
          postedAt: new Date(),
        };
      },
      mutate: (data) => ({
        ...data,
        title: `${data.title}_updated_${randomString()}`,
      }),
      notExistDocId: () => ({ postId: randomNumber(), authorId: 'post0' }),
      sortKey: ({ postId, authorId }) => `${postId}-${authorId}`,
    });

    describe('query', () => {
      const setup = <T extends CollectionSchema, const Items extends Model<T>[]>(params: {
        collection: T;
        items: Items;
      }) => {
        const repository = createRepository(uniqueCollection(params.collection));
        beforeAll(async () => {
          await repository.batchSet(params.items);
        });
        return {
          repository,
          items: params.items,
          expectQuery: async (query: Query<T>, expected: Model<T>[]) => {
            const result = await repository.list(query);
            // biome-ignore lint/suspicious/noMisplacedAssertion:
            expect(result).toStrictEqual(expected);
          },
        };
      };

      describe('root collection', () => {
        const { repository, expectQuery, items } = setup({
          collection: authorsCollection,
          items: [
            {
              authorId: '1',
              name: 'author1',
              profile: {
                age: 40,
                gender: 'male',
              },
              rank: 1,
              registeredAt: new Date('2020-02-01'),
            },
            {
              authorId: '2',
              name: 'author2',
              profile: {
                age: 90,
                gender: 'female',
              },
              rank: 2,
              registeredAt: new Date('2020-01-01'),
            },
            {
              authorId: '3',
              name: 'author3',
              profile: {
                age: 20,
              },
              rank: 2,
              registeredAt: new Date('2020-03-01'),
            },
          ],
        });

        it('query without condition', async () => {
          await expectQuery(query(repository.collection), items);
        });

        it('extend base query', async () => {
          const base = query(repository.collection, where($('profile.age', '>=', 40)));
          await expectQuery(query(base, orderBy('profile.age', 'desc')), [items[1], items[0]]);
        });

        describe('where', () => {
          it('simple', async () => {
            await expectQuery(query(repository.collection, where($('name', '==', 'author1'))), [
              items[0],
            ]);
            await expectQuery(query(repository.collection, where($('name', '!=', 'author1'))), [
              items[1],
              items[2],
            ]);
            // TODO for all operators
          });

          it('filter by nested field', async () => {
            await expectQuery(query(repository.collection, where($('profile.age', '>=', 40))), [
              items[0],
              items[1],
            ]);
            await expectQuery(
              query(repository.collection, where($('profile.gender', '==', 'male'))),
              [items[0]],
            );
          });

          it('filter by map value', async () => {
            await expectQuery(
              query(repository.collection, where($('profile', '==', { age: 40, gender: 'male' }))),
              [items[0]],
            );
          });

          it('multiple where clause', async () => {
            await expectQuery(
              query(
                repository.collection,
                where(or($('name', '==', 'author1'), $('name', '==', 'author2'))),
                where($('rank', '==', 2)),
              ),
              [items[1]],
            );
          });

          it('both child and parent query has where clause', async () => {
            await expectQuery(
              query(
                query(
                  repository.collection,
                  where(or($('name', '==', 'author1'), $('name', '==', 'author2'))),
                ),
                where($('rank', '==', 2)),
              ),
              [items[1]],
            );
          });

          it('or', async () => {
            await expectQuery(
              query(
                repository.collection,
                where(or($('name', '==', 'author1'), $('name', '==', 'author3'))),
              ),
              [items[0], items[2]],
            );

            await expectQuery(query(repository.collection, where(or())), items);
            await expectQuery(query(repository.collection, where(or($('name', '==', 'author1')))), [
              items[0],
            ]);
          });

          it('and', async () => {
            await expectQuery(
              query(
                repository.collection,
                where(
                  and($('name', '==', 'author1'), $('registeredAt', '==', new Date('2020-02-01'))),
                ),
              ),
              [items[0]],
            );

            await expectQuery(
              query(
                repository.collection,
                where(
                  and($('name', '==', 'author1'), $('registeredAt', '==', new Date('2020-02-02'))),
                ),
              ),
              [],
            );

            await expectQuery(query(repository.collection, where(and())), items);
            await expectQuery(
              query(repository.collection, where(and($('name', '==', 'author1')))),
              [items[0]],
            );
          });

          it('complex', async () => {
            await expectQuery(
              query(
                repository.collection,
                where(
                  or(
                    and(
                      $('name', '==', 'author1'),
                      $('registeredAt', '==', new Date('2020-02-01')),
                    ),
                    and(
                      $('name', '==', 'author2'),
                      $('registeredAt', '==', new Date('2020-01-01')),
                    ),
                  ),
                ),
              ),
              [items[0], items[1]],
            );
          });
        });

        it('orderBy', async () => {
          await expectQuery(query(repository.collection, orderBy('registeredAt')), [
            items[1],
            items[0],
            items[2],
          ]);
          await expectQuery(query(repository.collection, orderBy('registeredAt', 'asc')), [
            items[1],
            items[0],
            items[2],
          ]);
          await expectQuery(query(repository.collection, orderBy('registeredAt', 'desc')), [
            items[2],
            items[0],
            items[1],
          ]);
          await expectQuery(query(repository.collection, orderBy('__name__', 'asc')), items);
          await expectQuery(query(repository.collection, orderBy('rank'), orderBy('profile.age')), [
            items[0],
            items[2],
            items[1],
          ]);
          await expectQuery(
            query(repository.collection, orderBy('rank', 'desc'), orderBy('profile.age', 'desc')),
            [items[1], items[2], items[0]],
          );
        });

        it('limit', async () => {
          await expectQuery(query(repository.collection, limit(1)), [items[0]]);
          await expectQuery(query(repository.collection, limit(2)), [items[0], items[1]]);
          await expectQuery(query(repository.collection, limit(100)), items);
        });

        it('limitToLast', async () => {
          await expectQuery(query(repository.collection, orderBy('name'), limitToLast(1)), [
            items[2],
          ]);
          await expectQuery(query(repository.collection, orderBy('name'), limitToLast(2)), [
            items[1],
            items[2],
          ]);
          await expectQuery(query(repository.collection, orderBy('name'), limitToLast(100)), items);
        });

        const queryCursorTestCases = {
          id: ['__name__'],
          single: ['name'],
          nested: ['profile.age'],
          multiple: ['rank', 'profile.age'],
          multipleOrderSingleCursor: ['rank', 'profile.age'],
        } as const satisfies Record<string, FieldPath<DbModel<typeof repository.collection>>[]>;
        const defineQueryCursorTests = (
          cursorFunc: typeof startAt | typeof startAfter | typeof endAt | typeof endBefore,
          tests: Record<
            keyof typeof queryCursorTestCases,
            [unknown[], Model<typeof repository.collection>[]][]
          >,
        ) => {
          describe(cursorFunc.name, () => {
            for (const [testName, asserts] of Object.entries(tests)) {
              it(testName, async () => {
                const orderByConstraints = queryCursorTestCases[
                  testName as keyof typeof queryCursorTestCases
                ].map((f) => orderBy<typeof repository.collection>(f));

                for (const [cursorValues, expected] of asserts) {
                  await expectQuery(
                    query(
                      repository.collection,
                      ...orderByConstraints,
                      cursorFunc(...cursorValues),
                    ),
                    expected,
                  );
                }
              });
            }
          });
        };

        defineQueryCursorTests(startAt, {
          id: [
            [['1'], items],
            [['2'], items.slice(1)],
          ],
          single: [
            [['author1'], items],
            [['author2'], items.slice(1)],
          ],
          nested: [
            [[40], [items[0], items[1]]],
            [[41], [items[1]]],
          ],
          multiple: [
            [
              [2, 20],
              [items[2], items[1]],
            ],
            [[2, 21], [items[1]]],
          ],
          multipleOrderSingleCursor: [[[2], [items[2], items[1]]]],
        });

        defineQueryCursorTests(startAfter, {
          id: [
            [['0'], items],
            [['1'], items.slice(1)],
          ],
          single: [
            [['author1'], items.slice(1)],
            [['author2'], items.slice(2)],
          ],
          nested: [
            [[39], [items[0], items[1]]],
            [[40], [items[1]]],
          ],
          multiple: [
            [
              [2, 19],
              [items[2], items[1]],
            ],
            [[2, 20], [items[1]]],
          ],
          multipleOrderSingleCursor: [[[1], [items[2], items[1]]]],
        });

        defineQueryCursorTests(endAt, {
          id: [
            [['1'], [items[0]]],
            [['2'], [items[0], items[1]]],
          ],
          single: [
            [['author1'], [items[0]]],
            [['author2'], [items[0], items[1]]],
          ],
          nested: [
            [[39], [items[2]]],
            [[40], [items[2], items[0]]],
          ],
          multiple: [
            [[2, 19], [items[0]]],
            [
              [2, 20],
              [items[0], items[2]],
            ],
          ],
          multipleOrderSingleCursor: [[[1], [items[0]]]],
        });

        defineQueryCursorTests(endBefore, {
          id: [
            [['2'], [items[0]]],
            [['3'], [items[0], items[1]]],
          ],
          single: [
            [['author2'], [items[0]]],
            [['author3'], [items[0], items[1]]],
          ],
          nested: [
            [[40], [items[2]]],
            [[41], [items[2], items[0]]],
          ],
          multiple: [
            [[2, 20], [items[0]]],
            [
              [2, 21],
              [items[0], items[2]],
            ],
          ],
          multipleOrderSingleCursor: [[[2], [items[0]]]],
        });

        it('multiple constraints', async () => {
          await expectQuery(
            query(
              repository.collection,
              where($('name', '!=', 'author1')),
              orderBy('registeredAt', 'desc'),
              limit(1),
            ),
            [items[2]],
          );
        });

        it('aggregate', async () => {
          const res = await repository.aggregate({
            query: query(repository.collection),
            spec: {
              avgAge: average('profile.age'),
              sumAge: sum('profile.age'),
              count: count(),
            },
          });
          expectTypeOf(res).toEqualTypeOf<{ avgAge: number; sumAge: number; count: number }>();
          expect(res).toStrictEqual<typeof res>({ avgAge: 50, sumAge: 150, count: 3 });
        });
      });

      describe('subcollection', () => {
        const { repository, expectQuery, items } = setup({
          collection: postsCollection,
          items: [
            {
              postId: 1,
              title: 'post1',
              authorId: 'author1',
              postedAt: new Date('2020-02-01'),
            },
            {
              postId: 2,
              title: 'post2',
              authorId: 'author1',
              postedAt: new Date('2020-01-01'),
            },
            {
              postId: 3,
              title: 'post3',
              authorId: 'author2',
              postedAt: new Date('2020-03-01'),
            },
          ],
        });

        it('query without condition', async () => {
          await expectQuery(
            query({ collection: repository.collection, parent: { authorId: 'author1' } }),
            [items[0], items[1]],
          );
        });

        it('extend base query', async () => {
          const base = query({
            collection: repository.collection,
            parent: { authorId: 'author1' },
          });
          await expectQuery(query(base, orderBy('postedAt')), [items[1], items[0]]);
        });

        describe('where', () => {
          it('simple', async () => {
            await expectQuery(
              query(
                { collection: repository.collection, parent: { authorId: 'author1' } },
                orderBy('postedAt'),
              ),
              [items[1], items[0]],
            );
          });
        });

        describe('collectionGroupQuery', () => {
          it('simple', async () => {
            await expectQuery(collectionGroupQuery(repository.collection), items);
            await expectQuery(
              collectionGroupQuery(
                repository.collection,
                where($('postedAt', '>', new Date('2020-01-01'))),
              ),
              [items[0], items[2]],
            );
          });
        });
        // TODO
      });
    });

    describe('all field types', () => {
      const allFieldTypesCollection = collection({
        name: `AllFieldTypes_${randomString()}`,
        id: id('id'),
        data: coercible(
          (data: {
            array: (string | number)[];
            boolean: boolean;
            bytes: Bytes;
            timestamp: Timestamp;
            number: number;
            getPoint: GeoPoint;
            map: { a: number; b: string[] };
            null: null;
            docRef: DocumentReference;
            string: string;
            vector: VectorValue;
          }) => {
            return {
              ...data,
              timestamp: data.timestamp.toDate(),
            };
          },
        ),
        collectionPath: rootCollectionPath,
      });
      const repository = createRepository(allFieldTypesCollection);

      it('set/get', async () => {
        const value: Model<typeof allFieldTypesCollection> = {
          id: randomString(),
          array: [1, 2, 'foo', 3, 'bar'],
          boolean: false,
          bytes: types.bytes([1, 2, 3, 4, 5]),
          timestamp: new Date(),
          number: randomNumber(),
          getPoint: types.geoPoint(12.3, 45.6),
          map: { a: 123, b: ['foo', 'bar'] },
          null: null,
          docRef: types.documentReference('foo/a/bar/b'),
          string: randomString(),
          vector: types.vector([1, 2, 3, 4, 5]),
        };
        await repository.set(value);

        const dbValue = await repository.get(value);
        assert(dbValue);

        const { docRef, ...withoutDocRef } = value;
        const { docRef: dbDocRef, ...dbWithoutDocRef } = dbValue;

        expect(dbWithoutDocRef).toStrictEqual(withoutDocRef);
        // Some private field values of DocumentReference will be different
        expect(dbDocRef.path).toStrictEqual(docRef.path);
      });
    });
  });
};

export type RepositoryTestEnv<T extends CollectionSchema, Env extends FirestoreEnvironment> = {
  repository: Repository<T, Env>;
  items: [Model<T>, Model<T>, Model<T>, ...Model<T>[]];
  expectDb: (expected: Model<T>[]) => Promise<void>;
};

export type TestCollectionParams<T extends CollectionSchema = CollectionSchema> = {
  title: string;
  collection: T;
  newData: () => Model<T>;
  mutate: (data: Model<T>) => Model<T>;
  notExistDocId: () => Id<T>;
  sortKey: (id: Id<T>) => string;
};
