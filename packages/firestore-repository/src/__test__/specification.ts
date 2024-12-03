import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type CollectionSchema,
  type FirestoreEnvironment,
  type Id,
  type Model,
  type Repository,
  type Timestamp,
  collection,
  id,
  parentPath,
} from '../index.js';
import {
  type Limit,
  type LimitToLast,
  type OrderBy,
  type Query,
  type Where,
  and,
  is,
  or,
} from '../query.js';
import { randomNumber, randomString } from './util.js';

export type RepositoryTestEnv<T extends CollectionSchema, Env extends FirestoreEnvironment> = {
  repository: Repository<T, Env>;
  items: [Model<T>, Model<T>, Model<T>, ...Model<T>[]];
  expectDb: (expected: Model<T>[]) => Promise<void>;
};

/**
 * List of specifications that repository implementations must satisfy
 */
export const defineRepositorySpecificationTests = <Env extends FirestoreEnvironment>(
  createRepository: <T extends CollectionSchema>(collection: T) => Repository<T, Env>,
  environment: {
    queryConstraints: {
      where: Where<Env>;
      orderBy: OrderBy<Env>;
      limit: Limit<Env>;
      limitToLast: LimitToLast<Env>;
    };
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
          const items = (await repository.list(repository.collectionGroupQuery())) as Model<T>[];
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
      const { where, orderBy, limit, limitToLast } = environment.queryConstraints;

      describe('root collection', () => {
        const repository: Repository<Authors, Env> = createRepository(
          uniqueCollection(authorsCollection),
        );

        const expectQuery = async (
          query: Query<typeof authorsCollection, Env>,
          expected: Author[],
        ) => {
          const result = await repository.list(query);
          // biome-ignore lint/suspicious/noMisplacedAssertion:
          expect(result).toStrictEqual(expected);
        };

        const items: [Author, Author, Author, ...Author[]] = [
          {
            authorId: '1',
            name: 'author1',
            registeredAt: new Date('2020-02-01'),
          },
          {
            authorId: '2',
            name: 'author2',
            registeredAt: new Date('2020-01-01'),
          },
          {
            authorId: '3',
            name: 'author3',
            registeredAt: new Date('2020-03-01'),
          },
        ];

        beforeAll(async () => {
          await repository.batchSet(items);
        });

        describe('where', () => {
          it('simple', async () => {
            await expectQuery(repository.query({}, where(is('name', '==', 'author1'))), [items[0]]);
            await expectQuery(repository.query({}, where(is('name', '!=', 'author1'))), [
              items[1],
              items[2],
            ]);
            // TODO for all operators
          });

          it('or', async () => {
            await expectQuery(
              repository.query(
                {},
                where(or(is('name', '==', 'author1'), is('name', '==', 'author3'))),
              ),
              [items[0], items[2]],
            );

            await expectQuery(repository.query({}, where(or())), items);
            await expectQuery(repository.query({}, where(or(is('name', '==', 'author1')))), [
              items[0],
            ]);
          });

          it('and', async () => {
            await expectQuery(
              repository.query(
                {},
                where(
                  and(
                    is('name', '==', 'author1'),
                    is('registeredAt', '==', new Date('2020-02-01')),
                  ),
                ),
              ),
              [items[0]],
            );

            await expectQuery(
              repository.query(
                {},
                where(
                  and(
                    is('name', '==', 'author1'),
                    is('registeredAt', '==', new Date('2020-02-02')),
                  ),
                ),
              ),
              [],
            );

            await expectQuery(repository.query({}, where(and())), items);
            await expectQuery(repository.query({}, where(and(is('name', '==', 'author1')))), [
              items[0],
            ]);
          });

          it('complex', async () => {
            await expectQuery(
              repository.query(
                {},
                where(
                  or(
                    and(
                      is('name', '==', 'author1'),
                      is('registeredAt', '==', new Date('2020-02-01')),
                    ),
                    and(
                      is('name', '==', 'author2'),
                      is('registeredAt', '==', new Date('2020-01-01')),
                    ),
                  ),
                ),
              ),
              [items[0], items[1]],
            );
          });
        });

        it('orderBy', async () => {
          await expectQuery(repository.query({}, orderBy('registeredAt')), [
            items[1],
            items[0],
            items[2],
          ]);
          await expectQuery(repository.query({}, orderBy('registeredAt', 'asc')), [
            items[1],
            items[0],
            items[2],
          ]);
          await expectQuery(repository.query({}, orderBy('registeredAt', 'desc')), [
            items[2],
            items[0],
            items[1],
          ]);
        });

        it('limit', async () => {
          await expectQuery(repository.query({}, limit(1)), [items[0]]);
          await expectQuery(repository.query({}, limit(2)), [items[0], items[1]]);
          await expectQuery(repository.query({}, limit(100)), items);
        });

        it('limitToLast', async () => {
          await expectQuery(repository.query({}, orderBy('authorId'), limitToLast(1)), [items[2]]);
          await expectQuery(repository.query({}, orderBy('authorId'), limitToLast(2)), [
            items[1],
            items[2],
          ]);
          await expectQuery(repository.query({}, orderBy('authorId'), limitToLast(100)), items);
        });

        it('query composition', async () => {
          await expectQuery(
            repository.query(
              {},
              where(is('name', '!=', 'author1')),
              orderBy('registeredAt', 'desc'),
              limit(1),
            ),
            [items[2]],
          );
        });
      });
    });
  });
};

export type TestCollectionParams<T extends CollectionSchema = CollectionSchema> = {
  title: string;
  collection: T;
  newData: () => Model<T>;
  mutate: (data: Model<T>) => Model<T>;
  notExistDocId: () => Id<T>;
  sortKey: (id: Id<T>) => string;
};

/**
 * Root collection
 */
export const authorsCollection = collection({
  name: 'Authors',
  data: {
    from: (data: {
      authorId: string;
      name: string;
      registeredAt: Timestamp;
    }) => ({
      ...data,
      registeredAt: data.registeredAt.toDate(),
    }),
    to: (data) => data,
  },
  id: id('authorId'),
});
type Authors = typeof authorsCollection;
type Author = Model<Authors>;

/**
 * Subcollection
 */
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
type Posts = typeof postsCollection;
type Post = Model<Posts>;

/**
 * Duplicates a collection config with a unique collection name
 */
export const uniqueCollection = <T extends CollectionSchema>(collection: T): T => ({
  ...collection,
  name: `${collection.name}_${randomString()}`,
});
