import type { Aggregated, AggregateSpec } from './aggregate.js';
import type { Query } from './query.js';
import type { Collection, Doc, DocRef, DocToWrite, RootCollection } from './schema.js';

/**
 * A universal repository interface
 */
export interface Repository<
  T extends Collection = Collection,
  Model extends AppModel = AppModel,
  Env extends FirestoreEnvironment = FirestoreEnvironment,
> {
  collection: T;

  /**
   * Get single document by ID
   */
  get: (ref: Model['id'], options?: TransactionOption<Env>) => Promise<Model['read'] | undefined>;

  /**
   * Listen single document
   */
  getOnSnapshot: (
    ref: Model['id'],
    next: (snapshot: Model['read'] | undefined) => void,
    error?: (error: Error) => void,
  ) => Unsubscribe;

  /**
   * Returns a documents list of the specified query
   */
  list: (query: Query<T>) => Promise<IteratorObject<Model['read']>>;

  /**
   * Listen documents of the specified query
   */
  listOnSnapshot: (
    query: Query<T>,
    next: (snapshot: Model['read'][]) => void,
    error?: (error: Error) => void,
  ) => Unsubscribe;

  /**
   * Returns an aggregation of the specified query
   */
  aggregate: <U extends AggregateSpec<T>>(query: Query<T>, spec: U) => Promise<Aggregated<U>>;

  /**
   * Create or update
   */
  set: (doc: Model['write'], options?: WriteTransactionOption<Env>) => Promise<void>;

  /**
   * Delete a document by ID
   */
  delete: (ref: Model['id'], options?: WriteTransactionOption<Env>) => Promise<void>;

  /**
   * Create or update multiple documents
   */
  batchSet: (docs: Model['write'][], options?: WriteTransactionOption<Env>) => Promise<void>;

  /**
   * Delete documents by multiple ID
   */
  batchDelete: (refs: Model['id'][], options?: WriteTransactionOption<Env>) => Promise<void>;
}

export type Mapper<T extends Collection = Collection, Model extends AppModel = AppModel> = {
  toDocRef: (id: Model['id']) => DocRef<T>;
  fromFirestore: (doc: Doc<T>) => Model['read'];
  toFirestore: (model: Model['write']) => DocToWrite<T>;
};

export type AppModel<Id = unknown, R = unknown, W extends R = R> = { id: Id; read: R; write: W };

/**
 * Platform-specific types
 */
export type FirestoreEnvironment = { transaction: unknown; writeBatch: unknown };

export type TransactionOption<T extends FirestoreEnvironment> = { tx?: T['transaction'] };
export type WriteTransactionOption<T extends FirestoreEnvironment> = {
  tx?: T['transaction'] | T['writeBatch'];
};
export type Unsubscribe = () => void;

export type PlainRepository<
  T extends Collection = Collection,
  Env extends FirestoreEnvironment = FirestoreEnvironment,
> = Repository<T, PlainModel<T>, Env>;

export type PlainModel<T extends Collection> = {
  id: DocRef<T>;
  write: DocToWrite<T>;
  read: Doc<T>;
};

export type RootCollectionPlainModel<T extends Collection> = {
  id: string;
  write: DocToWrite<T>;
  read: Doc<T>;
};

export const plainMapper = <T extends Collection>(_collection: T): Mapper<T, PlainModel<T>> => ({
  toDocRef: (id) => id,
  fromFirestore: (doc) => doc,
  toFirestore: (model) => model,
});

export const rootCollectionPlainMapper = <T extends RootCollection>(
  _collection: T,
): Mapper<T, RootCollectionPlainModel<T>> => ({
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- type system doesn't expand DocRef<T> into [string]
  toDocRef: (id) => [id] as unknown as DocRef<T>,
  fromFirestore: (doc) => doc,
  toFirestore: (model) => model,
});
