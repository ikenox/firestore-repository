import type { AggregateQuery, Aggregated } from './aggregate.js';
import type { Query } from './query.js';
import type { CollectionSchema, Id, Model } from './schema.js';

/**
 * A universal repository interface
 */
export interface Repository<
  T extends CollectionSchema = CollectionSchema,
  Env extends FirestoreEnvironment = FirestoreEnvironment,
> {
  collection: T;

  /**
   * Get single document by ID
   */
  get: (id: Id<T>, options?: TransactionOption<Env>) => Promise<Model<T> | undefined>;

  /**
   * Listen single document
   */
  getOnSnapshot: (
    id: Id<T>,
    next: (snapshot: Model<T> | undefined) => void,
    error?: (error: Error) => void,
  ) => Unsubscribe;

  /**
   * Returns a documents list of the specified query
   */
  list: (query: Query<T>) => Promise<Model<T>[]>;

  /**
   * Listen documents of the specified query
   */
  listOnSnapshot: (
    query: Query<T>,
    next: (snapshot: Model<T>[]) => void,
    error?: (error: Error) => void,
  ) => Unsubscribe;

  /**
   * Returns an aggregation of the specified query
   */
  aggregate: <U extends AggregateQuery<T>>(aggregate: U) => Promise<Aggregated<U>>;

  /**
   * Create or update
   */
  set: (doc: Model<T>, options?: WriteTransactionOption<Env>) => Promise<void>;

  /**
   * Delete a document by ID
   */
  delete: (id: Id<T>, options?: WriteTransactionOption<Env>) => Promise<void>;

  /**
   * Create or update multiple documents
   */
  batchSet: (docs: Model<T>[], options?: WriteTransactionOption<Env>) => Promise<void>;

  /**
   * Delete documents by multiple ID
   */
  batchDelete: (ids: Id<T>[], options?: WriteTransactionOption<Env>) => Promise<void>;
}

/**
 * Platform-specific types
 */
export type FirestoreEnvironment = {
  transaction: unknown;
  writeBatch: unknown;
};
export type TransactionOption<T extends FirestoreEnvironment> = { tx?: T['transaction'] };
export type WriteTransactionOption<T extends FirestoreEnvironment> = {
  tx?: T['transaction'] | T['writeBatch'];
};
export type Unsubscribe = () => void;
