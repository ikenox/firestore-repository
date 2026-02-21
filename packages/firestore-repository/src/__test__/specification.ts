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
  and,
  condition as $,
  endAt,
  endBefore,
  type FilterExpression,
  limit,
  limitToLast,
  or,
  orderBy,
  type Query,
  query,
  startAfter,
  startAt,
} from '../query.js';
import type {
  AppModel,
  FirestoreEnvironment,
  Mapper,
  PlainRepository,
  Repository,
} from '../repository.js';
import {
  type Collection,
  type Doc,
  type DocRef,
  rootCollection,
  schemaWithoutValidation,
  subCollection,
} from '../schema.js';
import {
  expectArrayEqualsWithoutOrder,
  randomNumber,
  randomString,
  sleep,
  uniqueCollection,
} from './util.js';

/**
 * A root collection for test
 */
export const authorsCollection = rootCollection({
  name: 'Authors',
  data: schemaWithoutValidation<{
    name: string;
    profile: { age: number; gender?: 'male' | 'female' };
    rank: number;
    tag: string[];
  }>(),
});

/**
 * A subcollection for test
 */
export const postsCollection = subCollection({
  name: 'Posts',
  data: schemaWithoutValidation<{ title: string; postedAt: Timestamp }>(),
  parent: ['Authors'] as const,
});

/**
 * List of specifications that repository implementations must satisfy
 */
export const defineRepositorySpecificationTests = <Env extends FirestoreEnvironment>({
  db,
  createRepository,
  createRepositoryWithMapper,
  types,
  implementationSpecificTests,
}: {
  createRepository: <T extends Collection>(collection: T) => PlainRepository<T, Env>;
  createRepositoryWithMapper: <T extends Collection, Model extends AppModel>(
    collection: T,
    mapper: Mapper<T, Model>,
  ) => Repository<T, Model, Env>;
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
  implementationSpecificTests?: <T extends Collection>(
    params: TestCollectionParams<T>,
    setup: () => RepositoryTestEnv<T, Env>,
  ) => void;
}) => {
  const defineTests = <T extends Collection>(params: TestCollectionParams<T>) => {
    const setup = (): RepositoryTestEnv<T, Env> => {
      const items: [Doc<T>, Doc<T>, Doc<T>] = [
        params.newData(),
        params.newData(),
        params.newData(),
      ];

      // Use a new repository instance with unique collection for each test
      let currentRepository: PlainRepository<T, Env>;
      beforeEach(async () => {
        currentRepository = createRepository(uniqueCollection(params.collection));
        await currentRepository.batchSet(items);
      });

      // Create a proxy that always delegates to the current repository instance
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- proxy delegates to the current repository instance
      const repository = new Proxy(
        {},
        {
          get: (_, prop) => {
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- proxy handler
            return currentRepository[prop as keyof typeof currentRepository];
          },
        },
      ) as PlainRepository<T, Env>;

      return {
        repository,
        items,
        expectDb: async (expected: Doc<T>[]) => {
          const items = (
            await currentRepository.list(
              query({ collection: currentRepository.collection, group: true }),
            )
          ).toArray();
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
          expect(await repository.get(items[0].ref)).toStrictEqual(items[0]);
        });

        it('not found', async () => {
          expect(await repository.get(params.notExistDocId())).toBeUndefined();
        });

        it('transaction', async () => {
          const res = await db.transaction(async (tx) => {
            const item0 = await repository.get(items[0].ref, { tx });
            const item1 = await repository.get(items[1].ref, { tx });
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
          () => repository.delete(updated2.ref),
          () => repository.set(updated3),
        ];

        const received: (Doc<T> | undefined)[] = [];
        const unsubscribe = repository.getOnSnapshot(items[0].ref, (snapshot) => {
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
        const res = (
          await repository.list(query({ collection: repository.collection, group: true }))
        ).toArray();
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
          () => repository.delete(updated1.ref),
        ];

        const received: Doc<T>[][] = [];
        const unsubscribe = repository.listOnSnapshot(
          query({ collection: repository.collection, group: true }),
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
          await repository.delete(target.ref);
          await expectDb(rest);
        });

        it('if not exists', async () => {
          await repository.delete(params.notExistDocId());
          await expectDb(items);
        });

        describe('transaction', () => {
          it('success', async () => {
            await db.transaction(async (tx) => {
              await repository.delete(items[0].ref, { tx });
              await repository.delete(items[1].ref, { tx });
            });
            await expectDb([items[2]]);
          });

          it('abort', async () => {
            const promise = db.transaction(async (tx) => {
              await repository.delete(items[0].ref, { tx });
              await repository.delete(items[1].ref, { tx });
              throw new Error('abort');
            });
            await expect(promise).rejects.toThrowError('abort');
            await expectDb(items);
          });
        });

        it('writeBatch', async () => {
          const batch = db.writeBatch();
          await repository.delete(items[0].ref, { tx: batch });
          await repository.delete(items[1].ref, { tx: batch });
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
          await repository.batchDelete([target1.ref, target2.ref, params.notExistDocId()]);
          await expectDb(rest);
        });

        describe('transaction', () => {
          it('success', async () => {
            await db.transaction(async (tx) => {
              await repository.batchDelete([target1.ref, target2.ref, params.notExistDocId()], {
                tx,
              });
            });
            await expectDb(rest);
          });

          it('abort', async () => {
            const promise = db.transaction(async (tx) => {
              await repository.batchDelete([target1.ref, target2.ref, params.notExistDocId()], {
                tx,
              });
              throw new Error('abort');
            });
            await expect(promise).rejects.toThrowError('abort');
            await expectDb(items);
          });
        });

        it('writeBatch', async () => {
          const batch = db.writeBatch();
          await repository.batchDelete([target1.ref], { tx: batch });
          await repository.batchDelete([target2.ref], { tx: batch });
          await expectDb(items);
          await batch.commit();
          await expectDb(rest);
        });
      });

      if (implementationSpecificTests) {
        describe('implementation-specific tests', () => {
          implementationSpecificTests(params, setup);
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
          ref: [`author${id}`],
          data: {
            name: `name${id}`,
            profile: { age: randomNumber(), gender: 'male' as const },
            rank: randomNumber(),
            tag: [],
          },
        };
      },
      mutate: (data) => ({
        ...data,
        data: { ...data.data, name: `${data.data.name}_updated_${randomString()}` },
      }),
      notExistDocId: () => ['not-exists'],
      sortKey: (a) => a.ref[0],
    });

    defineTests({
      title: 'subcollection',
      collection: postsCollection,
      newData: () => {
        const id = baseId++;
        const authorId = baseId++;
        return {
          ref: [`author${authorId}`, `${id}`],
          data: { title: `post${id}`, postedAt: types.timestamp(new Date()) },
        };
      },
      mutate: (data) => ({
        ...data,
        data: { ...data.data, title: `${data.data.title}_updated_${randomString()}` },
      }),
      notExistDocId: () => ['author0', `${randomNumber()}`],
      sortKey: (doc) => `${doc.ref[1]}-${doc.ref[0]}`,
    });

    describe('query', () => {
      const setup = <T extends Collection, const Items extends Doc<T>[]>(params: {
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
          expectQuery: async (query: Query<T>, expected: Doc<T>[]) => {
            const result = (await repository.list(query)).toArray();
            expect(result).toStrictEqual(expected);
          },
        };
      };

      describe('root collection', () => {
        const { repository, expectQuery, items } = setup({
          collection: authorsCollection,
          items: [
            {
              ref: ['1'],
              data: {
                name: 'author1',
                profile: { age: 40, gender: 'male' },
                rank: 1,
                tag: ['a', 'b'],
              },
            },
            {
              ref: ['2'],
              data: {
                name: 'author2',
                profile: { age: 90, gender: 'female' },
                rank: 2,
                tag: ['b', 'c'],
              },
            },
            {
              ref: ['3'],
              data: { name: 'author3', profile: { age: 20 }, rank: 2, tag: ['c', 'd'] },
            },
          ] as const satisfies Doc<typeof authorsCollection>[],
        });

        it('query without condition', async () => {
          await expectQuery(query({ collection: repository.collection }), items);
        });

        it('extend base query', async () => {
          const base = query({ collection: repository.collection }, $('profile.age', '>=', 40));
          await expectQuery(query({ extends: base }, orderBy('profile.age', 'desc')), [
            items[1],
            items[0],
          ]);
        });

        describe('where', () => {
          describe('operators', () => {
            const tests: Record<
              string,
              [
                condition: FilterExpression<typeof authorsCollection>,
                expected: Doc<typeof authorsCollection>[],
              ]
            > = {
              '==': [$('name', '==', 'author1'), [items[0]]],
              '!=': [$('name', '!=', 'author1'), [items[1], items[2]]],
              '<': [$('profile.age', '<', 40), [items[2]]],
              '<=': [$('profile.age', '<=', 40), [items[2], items[0]]],
              '>': [$('profile.age', '>', 40), [items[1]]],
              '>=': [$('profile.age', '>=', 40), [items[0], items[1]]],
              in: [$('name', 'in', ['author1', 'author2']), [items[0], items[1]]],
              'not-in': [$('name', 'not-in', ['author1', 'author2']), [items[2]]],
              'array-contains': [$('tag', 'array-contains', 'b'), [items[0], items[1]]],
              'array-contains-any': [
                $('tag', 'array-contains-any', ['a', 'd']),
                [items[0], items[2]],
              ],
            };
            for (const [title, [condition, expected]] of Object.entries(tests)) {
              it(title, async () => {
                await expectQuery(
                  query({ collection: repository.collection }, condition),
                  expected,
                );
              });
            }
          });

          it('filter by id', async () => {
            await expectQuery(
              query({ collection: repository.collection }, $('__name__', '==', '1')),
              [items[0]],
            );
            await expectQuery(
              query({ collection: repository.collection }, $('__name__', '==', '2')),
              [items[1]],
            );
          });

          it('filter by nested field', async () => {
            await expectQuery(
              query({ collection: repository.collection }, $('profile.age', '>=', 40)),
              [items[0], items[1]],
            );
            await expectQuery(
              query({ collection: repository.collection }, $('profile.gender', '==', 'male')),
              [items[0]],
            );
          });

          it('filter by map value', async () => {
            await expectQuery(
              query(
                { collection: repository.collection },
                $('profile', '==', { age: 40, gender: 'male' }),
              ),
              [items[0]],
            );
          });

          it('multiple filter expressions in a query are combined by AND condition', async () => {
            await expectQuery(
              query(
                { collection: repository.collection },
                or($('name', '==', 'author1'), $('name', '==', 'author2')),
                $('rank', '==', 2),
              ),
              [items[1]],
            );
          });

          it('filter expressions of child and parent query are combined by AND condition', async () => {
            const baseQuery = query(
              { collection: repository.collection },
              or($('name', '==', 'author1'), $('name', '==', 'author2')),
            );
            await expectQuery(query({ extends: baseQuery }, $('rank', '==', 2)), [items[1]]);
          });

          it('or', async () => {
            await expectQuery(
              query(
                { collection: repository.collection },
                or($('name', '==', 'author1'), $('name', '==', 'author3')),
              ),
              [items[0], items[2]],
            );

            await expectQuery(query({ collection: repository.collection }, or()), items);
            await expectQuery(
              query({ collection: repository.collection }, or($('name', '==', 'author1'))),
              [items[0]],
            );
          });

          it('and', async () => {
            await expectQuery(
              query(
                { collection: repository.collection },
                and($('name', '==', 'author1'), $('profile.age', '==', 40)),
              ),
              [items[0]],
            );

            await expectQuery(
              query(
                { collection: repository.collection },
                and($('name', '==', 'author1'), $('profile.age', '==', 41)),
              ),
              [],
            );

            await expectQuery(query({ collection: repository.collection }, and()), items);
            await expectQuery(
              query({ collection: repository.collection }, and($('name', '==', 'author1'))),
              [items[0]],
            );
          });

          it('complex', async () => {
            await expectQuery(
              query(
                { collection: repository.collection },
                or(
                  and($('name', '==', 'author1'), $('profile.age', '==', 40)),
                  and($('name', '==', 'author2'), $('profile.age', '==', 90)),
                ),
              ),
              [items[0], items[1]],
            );
            await expectQuery(
              query(
                { collection: repository.collection },
                or(
                  and($('name', '!=', 'author1'), $('profile.age', '==', 40)),
                  and($('name', '==', 'author2'), $('profile.age', '==', 90)),
                ),
              ),
              [items[1]],
            );
            await expectQuery(
              query(
                { collection: repository.collection },
                or(
                  and($('name', '==', 'author1'), $('profile.age', '==', 40)),
                  and($('name', '!=', 'author2'), $('profile.age', '==', 90)),
                ),
              ),
              [items[0]],
            );
          });
        });

        it('orderBy', async () => {
          await expectQuery(query({ collection: repository.collection }, orderBy('profile.age')), [
            items[2],
            items[0],
            items[1],
          ]);
          await expectQuery(
            query({ collection: repository.collection }, orderBy('profile.age', 'asc')),
            [items[2], items[0], items[1]],
          );
          await expectQuery(
            query({ collection: repository.collection }, orderBy('profile.age', 'desc')),
            [items[1], items[0], items[2]],
          );
          await expectQuery(
            query({ collection: repository.collection }, orderBy('__name__', 'asc')),
            items,
          );
          await expectQuery(
            query({ collection: repository.collection }, orderBy('rank'), orderBy('profile.age')),
            [items[0], items[2], items[1]],
          );
          await expectQuery(
            query(
              { collection: repository.collection },
              orderBy('rank', 'desc'),
              orderBy('profile.age', 'desc'),
            ),
            [items[1], items[2], items[0]],
          );
        });

        it('limit', async () => {
          await expectQuery(query({ collection: repository.collection }, limit(1)), [items[0]]);
          await expectQuery(query({ collection: repository.collection }, limit(2)), [
            items[0],
            items[1],
          ]);
          await expectQuery(query({ collection: repository.collection }, limit(100)), items);
        });

        it('limitToLast', async () => {
          await expectQuery(
            query({ collection: repository.collection }, orderBy('name'), limitToLast(1)),
            [items[2]],
          );
          await expectQuery(
            query({ collection: repository.collection }, orderBy('name'), limitToLast(2)),
            [items[1], items[2]],
          );
          await expectQuery(
            query({ collection: repository.collection }, orderBy('name'), limitToLast(100)),
            items,
          );
        });

        const queryCursorTestCases = {
          id: ['__name__'],
          single: ['name'],
          nested: ['profile.age'],
          multiple: ['rank', 'profile.age'],
          multipleOrderSingleCursor: ['rank', 'profile.age'],
        } as const satisfies Record<string, FieldPath[]>;
        const defineQueryCursorTests = (
          cursorFunc: typeof startAt | typeof startAfter | typeof endAt | typeof endBefore,
          tests: Record<
            keyof typeof queryCursorTestCases,
            [unknown[], Doc<typeof repository.collection>[]][]
          >,
        ) => {
          describe(cursorFunc.name, () => {
            for (const [testName, asserts] of Object.entries(tests)) {
              it(testName, async () => {
                const orderByConstraints = queryCursorTestCases[
                  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Object.entries loses type information of object keys
                  testName as keyof typeof queryCursorTestCases
                ].map((f) => orderBy<typeof repository.collection>(f));

                for (const [cursorValues, expected] of asserts) {
                  await expectQuery(
                    query(
                      { collection: repository.collection },
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
              { collection: repository.collection },
              $('name', '!=', 'author1'),
              orderBy('profile.age', 'desc'),
              limit(1),
            ),
            [items[1]],
          );
        });

        it('aggregate', async () => {
          const res = await repository.aggregate(query({ collection: repository.collection }), {
            avgAge: average('profile.age'),
            sumAge: sum('profile.age'),
            count: count(),
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
              ref: ['author1', '1'],
              data: { title: 'post1', postedAt: types.timestamp(new Date('2020-02-01')) },
            },
            {
              ref: ['author1', '2'],
              data: { title: 'post2', postedAt: types.timestamp(new Date('2020-01-01')) },
            },
            {
              ref: ['author2', '3'],
              data: { title: 'post3', postedAt: types.timestamp(new Date('2020-03-01')) },
            },
          ],
        });

        it('query without condition', async () => {
          await expectQuery(query({ collection: repository.collection, parent: ['author1'] }), [
            items[0],
            items[1],
          ]);
        });

        it('extend base query', async () => {
          const base = query({ collection: repository.collection, parent: ['author1'] });
          await expectQuery(query({ extends: base }, orderBy('postedAt')), [items[1], items[0]]);
        });

        describe('where', () => {
          it('simple', async () => {
            await expectQuery(
              query(
                { collection: repository.collection, parent: ['author1'] },
                orderBy('postedAt'),
              ),
              [items[1], items[0]],
            );
          });
        });

        describe('collectionGroupQuery', () => {
          it('simple', async () => {
            await expectQuery(query({ collection: repository.collection, group: true }), items);
            await expectQuery(
              query(
                { collection: repository.collection, group: true },
                $('postedAt', '>', new Date('2020-01-01')),
              ),
              [items[0], items[2]],
            );
          });
        });
      });
    });

    describe('all field types', () => {
      const allFieldTypesCollection = rootCollection({
        name: `AllFieldTypes_${randomString()}`,
        data: schemaWithoutValidation<{
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
        }>(),
      });
      const repository = createRepository(allFieldTypesCollection);

      it('set/get', async () => {
        const value: Doc<typeof allFieldTypesCollection> = {
          ref: [randomString()],
          data: {
            array: [1, 2, 'foo', 3, 'bar'],
            boolean: false,
            bytes: types.bytes([1, 2, 3, 4, 5]),
            timestamp: types.timestamp(new Date()),
            number: randomNumber(),
            getPoint: types.geoPoint(12.3, 45.6),
            map: { a: 123, b: ['foo', 'bar'] },
            null: null,
            docRef: types.documentReference('foo/a/bar/b'),
            string: randomString(),
            vector: types.vector([1, 2, 3, 4, 5]),
          },
        };
        await repository.set(value);

        const dbValue = await repository.get(value.ref);
        assert(dbValue);

        const {
          data: { docRef, ...withoutDocRef },
          ...rest
        } = value;
        const {
          data: { docRef: dbDocRef, ...dbWithoutDocRef },
          ...dbRest
        } = dbValue;

        expect({ ...dbRest, data: dbWithoutDocRef }).toStrictEqual({
          ...rest,
          data: withoutDocRef,
        });
        // @ts-expect-error -- Some private field values of DocumentReference will be different
        expect(dbDocRef.path).toStrictEqual(docRef.path);
      });
    });

    describe('custom mapper with serializer/deserializer', () => {
      // Define a collection with Firestore types
      const testCollection = rootCollection({
        name: `CustomMapperTest_${randomString()}`,
        data: schemaWithoutValidation<{
          createdAt: Timestamp;
          location: GeoPoint;
          content: Bytes;
        }>(),
      });

      // Define an application model with plain JavaScript types
      type AppModel = {
        id: string;
        read: {
          id: string;
          createdAt: Date;
          location: { lat: number; lng: number };
          content: Uint8Array;
        };
        write: {
          id: string;
          createdAt: Date;
          location: { lat: number; lng: number };
          content: Uint8Array;
        };
      };

      it('serialize/deserialize platform-specific types', async () => {
        const repository = createRepositoryWithMapper<typeof testCollection, AppModel>(
          testCollection,
          {
            toDocRef: (id) => [id],
            fromFirestore: (doc, deserializer) => ({
              id: doc.ref[0],
              createdAt: deserializer.timestamp(doc.data.createdAt),
              location: {
                lat: deserializer.geoPoint(doc.data.location).latitude,
                lng: deserializer.geoPoint(doc.data.location).longitude,
              },
              content: deserializer.bytes(doc.data.content),
            }),
            toFirestore: (model, serializer) => ({
              ref: [model.id],
              data: {
                createdAt: serializer.timestamp(model.createdAt),
                location: serializer.geoPoint({
                  latitude: model.location.lat,
                  longitude: model.location.lng,
                }),
                content: serializer.bytes(model.content),
              },
            }),
          },
        );

        const testDate = new Date('2024-01-01T00:00:00Z');
        const testBuffer = new Uint8Array(new ArrayBuffer(8));
        testBuffer.set([1, 2, 3, 4, 5, 6, 7, 8]);

        const appData: AppModel['write'] = {
          id: randomString(),
          createdAt: testDate,
          location: { lat: 35.6812, lng: 139.7671 },
          content: testBuffer,
        };

        // Set using application model
        await repository.set(appData);

        // Get and verify deserialization
        const retrieved = await repository.get(appData.id);
        assert(retrieved);

        expect(retrieved.id).toBe(appData.id);
        expect(retrieved.createdAt).toBeInstanceOf(Date);
        expect(retrieved.createdAt.getTime()).toBe(testDate.getTime());
        expect(retrieved.location).toStrictEqual({ lat: 35.6812, lng: 139.7671 });
        expect(new Uint8Array(retrieved.content)).toStrictEqual(
          new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
        );
      });

      describe('sentinel values', () => {
        const sentinelCollection = rootCollection({
          name: `SentinelTest_${randomString()}`,
          data: schemaWithoutValidation<{
            updatedAt: Timestamp;
            counter: number;
            tags: string[];
          }>(),
        });

        type SentinelAppModel = {
          id: string;
          read: { id: string; updatedAt: Date; counter: number; tags: string[] };
          write: {
            id: string;
            updatedAt: Date | 'serverTimestamp';
            counter: number | { increment: number };
            tags: string[] | { arrayUnion: string[] } | { arrayRemove: string[] };
          };
        };

        const repository = createRepositoryWithMapper<typeof sentinelCollection, SentinelAppModel>(
          sentinelCollection,
          {
            toDocRef: (id) => [id],
            fromFirestore: (doc, deserializer) => ({
              id: doc.ref[0],
              updatedAt: deserializer.timestamp(doc.data.updatedAt),
              counter: doc.data.counter,
              tags: doc.data.tags,
            }),
            toFirestore: (model, serializer) => ({
              ref: [model.id],
              data: {
                updatedAt:
                  model.updatedAt === 'serverTimestamp'
                    ? serializer.serverTimestamp()
                    : serializer.timestamp(model.updatedAt),
                counter:
                  typeof model.counter === 'object' && 'increment' in model.counter
                    ? serializer.increment(model.counter.increment)
                    : model.counter,
                tags: Array.isArray(model.tags)
                  ? model.tags
                  : 'arrayUnion' in model.tags
                    ? serializer.arrayUnion(...model.tags.arrayUnion)
                    : serializer.arrayRemove(...model.tags.arrayRemove),
              },
            }),
          },
        );

        it('serverTimestamp', async () => {
          const id = randomString();

          const beforeWrite = new Date();
          await repository.set({ id, updatedAt: 'serverTimestamp', counter: 1, tags: [] });
          const afterWrite = new Date();

          const doc = await repository.get(id);
          assert(doc);
          expect(doc.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeWrite.getTime());
          expect(doc.updatedAt.getTime()).toBeLessThanOrEqual(afterWrite.getTime());
        });

        it.todo(
          'increment (requires update/merge - set() replaces entire document so increment creates new value instead of adding)',
        );

        it.todo(
          'arrayUnion (requires update/merge - set() replaces entire document so arrays are not merged)',
        );

        it.todo(
          'arrayRemove (requires update/merge - set() replaces entire document so arrays are not merged)',
        );
      });
    });
  });
};

export type RepositoryTestEnv<T extends Collection, Env extends FirestoreEnvironment> = {
  repository: PlainRepository<T, Env>;
  items: [Doc<T>, Doc<T>, Doc<T>, ...Doc<T>[]];
  expectDb: (expected: Doc<T>[]) => Promise<void>;
};

export type TestCollectionParams<T extends Collection = Collection> = {
  title: string;
  collection: T;
  newData: () => Doc<T>;
  mutate: (data: Doc<T>) => Doc<T>;
  notExistDocId: () => DocRef<T>;
  sortKey: (doc: Doc<T>) => string;
};
