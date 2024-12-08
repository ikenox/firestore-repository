import type { FieldPath } from './document.js';
import type { Query, QueryConstraint } from './query.js';
import type { CollectionSchema, DbModel, Id, Model, ParentId } from './schema.js';

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
  list: (query: Query<T, Env>) => Promise<Model<T>[]>;

  /**
   * Listen documents of the specified query
   */
  listOnSnapshot: (
    query: Query<T, Env>,
    next: (snapshot: Model<T>[]) => void,
    error?: (error: Error) => void,
  ) => Unsubscribe;

  /**
   * Returns an aggregation of the specified query
   */
  aggregate: <T extends CollectionSchema, U extends AggregateSpec<T>>(
    query: Query<T, Env>,
    spec: U,
  ) => Promise<Aggregated<U>>;

  /**
   * Start a query or chaining another query
   */
  query: QueryFunction<T, Env>;

  /**
   * Start a collection group query
   */
  collectionGroupQuery: (...constraints: QueryConstraint<Query<T, Env>>[]) => Query<T, Env>;

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

export type QueryFunction<T extends CollectionSchema, Env extends FirestoreEnvironment> = [
  keyof ParentId<T>,
] extends [never]
  ? RootCollectionQueryBuilder<T, Env>
  : SubcollectionQueryBuilder<T, Env>;
export type RootCollectionQueryBuilder<
  T extends CollectionSchema,
  Env extends FirestoreEnvironment,
> = (
  queryOrConstraint?: Query<T, Env> | QueryConstraint<Query<T, Env>>,
  ...constraints: QueryConstraint<Query<T, Env>>[]
) => Query<T, Env>;
export type SubcollectionQueryBuilder<
  T extends CollectionSchema,
  Env extends FirestoreEnvironment,
> = (
  parentIdOrQuery: ParentId<T> | Query<T, Env>,
  ...constraints: QueryConstraint<Query<T, Env>>[]
) => Query<T, Env>;
/**
 * Platform-specific types
 */
export type FirestoreEnvironment = {
  transaction: unknown;
  writeBatch: unknown;
  query: unknown;
};
export type TransactionOption<T extends FirestoreEnvironment> = { tx?: T['transaction'] };
export type WriteTransactionOption<T extends FirestoreEnvironment> = {
  tx?: T['transaction'] | T['writeBatch'];
};
export type Unsubscribe = () => void;
