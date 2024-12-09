import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { average, count, sum } from '../aggregate.js';
import type { Timestamp } from '../document.js';
import {
  condition as $,
  type Query,
  and,
  collectionGroupQuery,
  limit,
  limitToLast,
  or,
  orderBy,
  query,
  where,
} from '../query.js';
import type { FirestoreEnvironment, Repository } from '../repository.js';
import {
  type CollectionSchema,
  type Id,
  type Model,
  collection,
  id,
  parentPath,
} from '../schema.js';
import { randomNumber, uniqueCollection } from './util.js';

// root collection
export const authorsCollection = collection({
  name: 'Authors',
  data: {
    from: (data: {
      authorId: string;
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
    to: (data) => data,
  },
  id: id('authorId'),
});

// subcollection
export const postsCollection = collection({
  name: 'Posts',
  data: {
    from: (data: {
      postId: number;
      title: string;
      postedAt: Timestamp;
      authorId: string;
    }) => ({
      ...data,
      postedAt: data.postedAt.toDate(),
    }),
    to: (data) => data,
  },
  id: id('postId'),
  parentPath: parentPath(authorsCollection, 'authorId'),
});

/**
 * List of specifications that repository implementations must satisfy
 */
export const defineRepositorySpecificationTests = <Env extends FirestoreEnvironment>(
  createRepository: <T extends CollectionSchema>(collection: T) => Repository<T, Env>,
  environment: {
    implementationSpecificTests?: <T extends CollectionSchema>(
      params: TestCollectionParams<T>,
      setup: () => RepositoryTestEnv<T, Env>,
    ) => void;
  },
) => {
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
      });

      describe('batchSet', () => {
        it('empty', async () => {
          await repository.batchSet([]);
          await expectDb(items);
        });
        it('multi', async () => {
          const [target, ...rest] = items;
          const updatedItem = params.mutate(target);
          const newItem = params.newData();
          await repository.batchSet([newItem, updatedItem]);
          await expectDb([updatedItem, newItem, ...rest]);
        });
      });

      describe('batchDelete', () => {
        it('empty', async () => {
          await repository.batchDelete([]);
        });
        it('multi', async () => {
          const [target, ...rest] = items;
          await repository.batchDelete([target, params.notExistDocId()]);
          await expectDb(rest);
        });
      });

      if (environment.implementationSpecificTests) {
        describe('implementation-specific tests', () => {
          environment.implementationSpecificTests?.(params, setup);
        });
      }
    });
  };

  describe('repository specifications', () => {
    defineTests({
      title: 'root collection',
      collection: authorsCollection,
      newData: () => {
        const id = randomNumber();
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
        name: `${data.name}_updated`,
      }),
      notExistDocId: () => ({ authorId: 'not-exists' }),
      sortKey: (a) => a.authorId,
    });

    defineTests({
      title: 'subcollection',
      collection: postsCollection,
      newData: () => {
        const id = randomNumber();
        const authorId = randomNumber();
        return {
          postId: id,
          title: `post${id}`,
          authorId: `author${authorId}`,
          postedAt: new Date(),
        };
      },
      mutate: (data) => ({
        ...data,
        title: `${data.title}_updated`,
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

        it('query function argument', () => {
          // expectTypeOf<Parameters<typeof repository.query>[0]>().toEqualTypeOf<
          //   // root collection doesn't have parentId so it's no need to be specified as argument
          //   | Query<typeof authorsCollection, Env>
          //   | QueryConstraint<Query<typeof authorsCollection, Env>>
          //   // first argument can be omitted for root collection query
          //   | undefined
          // >();
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
          await expectQuery(query(repository.collection, orderBy('authorId'), limitToLast(1)), [
            items[2],
          ]);
          await expectQuery(query(repository.collection, orderBy('authorId'), limitToLast(2)), [
            items[1],
            items[2],
          ]);
          await expectQuery(
            query(repository.collection, orderBy('authorId'), limitToLast(100)),
            items,
          );
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
          const res = await repository.aggregate(query(repository.collection), {
            avgAge: average('profile.age'),
            sumAge: sum('profile.age'),
            count: count(),
          });
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

        it('query function argument', () => {
          // subcollection query must specify parentId or base query at first argument
          // expectTypeOf<Parameters<typeof repository.query>[0]>().toEqualTypeOf<
          //   ParentId<typeof repository.collection> | Query<typeof repository.collection, Env>
          // >();
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
