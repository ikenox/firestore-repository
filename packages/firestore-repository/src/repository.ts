import type { Aggregated, AggregateSpec } from './aggregate.js';
import type { Query } from './query.js';
import type { Collection, Doc, DocRef, DocToWrite } from './schema.js';

/**
 * A universal repository interface
 */
export interface Repository<
  T extends Collection = Collection,
  Env extends FirestoreEnvironment = FirestoreEnvironment,
> {
  collection: T;

  /**
   * Get single document by ID
   */
  get: (ref: DocRef<T>, options?: TransactionOption<Env>) => Promise<Doc<T> | undefined>;

  /**
   * Listen single document
   */
  getOnSnapshot: (
    ref: DocRef<T>,
    next: (snapshot: Doc<T> | undefined) => void,
    error?: (error: Error) => void,
  ) => Unsubscribe;

  /**
   * Returns a documents list of the specified query
   */
  list: (query: Query<T>) => Promise<Doc<T>[]>;

  /**
   * Listen documents of the specified query
   */
  listOnSnapshot: (
    query: Query<T>,
    next: (snapshot: Doc<T>[]) => void,
    error?: (error: Error) => void,
  ) => Unsubscribe;

  /**
   * Returns an aggregation of the specified query
   */
  aggregate: <U extends AggregateSpec<T>>(query: Query<T>, spec: U) => Promise<Aggregated<U>>;

  /**
   * Create or update
   */
  set: (doc: DocToWrite<T>, options?: WriteTransactionOption<Env>) => Promise<void>;

  /**
   * Delete a document by ID
   */
  delete: (ref: DocRef<T>, options?: WriteTransactionOption<Env>) => Promise<void>;

  /**
   * Create or update multiple documents
   */
  batchSet: (docs: DocToWrite<T>[], options?: WriteTransactionOption<Env>) => Promise<void>;

  /**
   * Delete documents by multiple ID
   */
  batchDelete: (refs: DocRef<T>[], options?: WriteTransactionOption<Env>) => Promise<void>;
}

/**
 * Platform-specific types
 */
export type FirestoreEnvironment = { transaction: unknown; writeBatch: unknown };
export type TransactionOption<T extends FirestoreEnvironment> = { tx?: T['transaction'] };
export type WriteTransactionOption<T extends FirestoreEnvironment> = {
  tx?: T['transaction'] | T['writeBatch'];
};
export type Unsubscribe = () => void;
