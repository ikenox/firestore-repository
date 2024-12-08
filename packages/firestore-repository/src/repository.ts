import type { FieldPath } from './document.js';
import type { Query } from './query.js';
import type { CollectionSchema, DbModel, Id, Model } from './schema.js';

export type Aggregated<T extends AggregateSpec> = {
  [K in keyof T]: number;
};
export type AggregateSpec<T extends CollectionSchema = CollectionSchema> = Record<
  string,
  AggregateMethod<T>
>;
export type AggregateMethod<T extends CollectionSchema> = Count | Sum<T> | Average<T>;
export type Count = { kind: 'count' };
export type Sum<T extends CollectionSchema> = { kind: 'sum'; path: FieldPath<DbModel<T>> };
export type Average<T extends CollectionSchema> = { kind: 'average'; path: FieldPath<DbModel<T>> };
export const sum = <T extends CollectionSchema>(path: FieldPath<DbModel<T>>): Sum<T> => ({
  kind: 'sum',
  path,
});
export const average = <T extends CollectionSchema>(path: FieldPath<DbModel<T>>): Average<T> => ({
  kind: 'average',
  path,
});
export const count = (): Count => ({
  kind: 'count',
});

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
  aggregate: <T extends CollectionSchema, U extends AggregateSpec<T>>(
    query: Query<T>,
    spec: U,
  ) => Promise<Aggregated<U>>;

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
