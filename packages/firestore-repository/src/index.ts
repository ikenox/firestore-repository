import type * as sdk from '@firebase/firestore';
import type * as admin from 'firebase-admin/firestore';
import type { Prettify } from '../../../src/util.js';
import type { Query, QueryConstraint } from './query.js';

/**
 * An entrypoint of schema definition
 */
export const collection = <
  DbModel extends DocumentData = DocumentData,
  Parent extends CollectionSchema = CollectionSchema,
  ModelData extends Record<string, unknown> = Record<never, never>,
  ModelId extends Record<string, unknown> = Record<never, never>,
  ModelParentId extends Record<string, unknown> = Record<never, never>,
>(
  schema: CollectionSchema<DbModel, Parent, ModelData, ModelId, ModelParentId>,
): CollectionSchema<DbModel, Parent, ModelData, ModelId, ModelParentId> =>
  schema as CollectionSchema<DbModel, Parent, ModelData, ModelId, ModelParentId>;

/**
 * A utility method to define simple id field
 */
export const as = <const T extends string>(fieldName: T): ModelIdSchema<Record<T, string>> => ({
  from: (id) => ({ [fieldName]: id }) as Record<T, string>,
  to: (data) => data[fieldName],
});

/**
 * A definition of firestore collection
 */
export type CollectionSchema<
  DbModel extends DocumentData = DocumentData,
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  Parent extends CollectionSchema = any,
  ModelData extends Record<string, unknown> = Record<never, never>,
  ModelId extends Record<string, unknown> = Record<never, never>,
  // TODO allow undefined?
  ModelParentId extends Record<string, unknown> = Record<never, never>,
> = {
  name: string;
  id: ModelIdSchema<ModelId>;
  parent?: {
    schema: Parent;
    id: {
      from(id: Id<Parent>): ModelParentId;
      to(id: ModelParentId): Id<Parent>;
    };
  };
  data: {
    from(data: DbModel): ModelData;
    // TODO allow Date etc.
    to(data: NoInfer<Prettify<ModelId & ModelParentId & ModelData>>): NoInfer<DbModel>;
  };
};

export type DbModel<T extends CollectionSchema> = T extends CollectionSchema<infer A> ? A : never;
export type Model<T extends CollectionSchema> = T extends CollectionSchema<
  DocumentData,
  CollectionSchema,
  infer ModelData,
  infer ModelId,
  infer ModelParentId
>
  ? Prettify<ModelId & ModelParentId & ModelData>
  : never;
export type Id<T extends CollectionSchema> = T extends CollectionSchema<
  DocumentData,
  CollectionSchema,
  Record<string, unknown>,
  infer ModelId,
  infer ModelParentId
>
  ? ModelId & ModelParentId
  : never;
export type ParentId<T extends CollectionSchema> = T extends CollectionSchema<
  DocumentData,
  CollectionSchema,
  Record<string, unknown>,
  Record<string, unknown>,
  infer ModelParentId
>
  ? ModelParentId
  : never;
export type ModelData<T extends CollectionSchema> = T extends CollectionSchema<
  DocumentData,
  CollectionSchema,
  infer ModelData,
  Record<string, unknown>,
  Record<string, unknown>
>
  ? ModelData
  : never;

export type ModelIdSchema<ModelId extends Record<string, unknown> = Record<string, unknown>> = {
  from(id: string): ModelId;
  to(id: ModelId): string;
};

export const docPath = <T extends CollectionSchema>(schema: T, id: Id<T>): string => {
  const docId = schema.id.to(id);
  return `${collectionPath(schema, id)}/${docId}`;
};

export const collectionPath = <T extends CollectionSchema>(schema: T, id: ParentId<T>): string => {
  return schema.parent?.schema
    ? `${docPath(schema.parent.schema, schema.parent.id.to(id))}/${schema.name}`
    : schema.name;
};

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

  list: (query: Query<T>) => Promise<Model<T>[]>;

  /**
   * Listen documents by the specified query
   */
  listOnSnapshot: (
    query: Query<T, Env>,
    next: (snapshot: Model<T>[]) => void,
    error?: (error: Error) => void,
  ) => Unsubscribe;

  /**
   * Start a query or chaining another query
   * TODO improve interface query(parentId).constraint(...)
   */
  query: (
    parentIdOrQuery: ParentId<T> | Query<T, Env>,
    ...constraints: QueryConstraint<Query<T, Env>>[]
  ) => Query<T, Env>;

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

export const queryTag: unique symbol = Symbol();

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

/**
 * Type of firestore document data
 */
export type DocumentData = {
  [key: string]: ValueType;
};

/**
 * Type of firestore field value
 */
export type ValueType =
  | number
  | string
  | null
  | Timestamp
  | DocumentReference
  | GeoPoint
  | ValueType[]
  | MapValue;

export type Timestamp = sdk.Timestamp | admin.Timestamp;
export type DocumentReference = sdk.DocumentReference | admin.DocumentReference;
export type GeoPoint = sdk.GeoPoint | admin.GeoPoint;
export type MapValue = { [K in string]: ValueType };
