import type * as admin from 'firebase-admin/firestore';
import type * as sdk from 'firebase/firestore';
import { Prettify } from './util.js';

/**
 * An entrypoint of schema definition
 */
export const collection = <
  DbModel extends DocumentData = DocumentData,
  Parent extends CollectionSchema = any,
  ModelData extends Record<string, unknown> = Record<never, never>,
  ModelId extends Record<string, unknown> = Record<never, never>,
  ModelParentId extends Record<string, unknown> = Record<never, never>,
>(
  schema: Omit<
    CollectionSchema<DbModel, Parent, ModelData, ModelId, ModelParentId>,
    // Omit phantom type fields
    `\$${string}`
  >,
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
  Parent extends CollectionSchema = any,
  ModelData extends Record<string, unknown> = Record<never, never>,
  ModelId extends Record<string, unknown> = Record<never, never>,
  ModelParentId extends Record<string, unknown> = Record<never, never>,
> = {
  name: string;
  id: ModelIdSchema<ModelId>;
  parent?: {
    schema: Parent;
    id: {
      from(id: Parent['$id']): ModelParentId;
      to(id: ModelParentId): Parent['$id'];
    };
  };
  data: {
    from(data: DbModel): ModelData;
    // TODO allow Date etc.
    to(data: NoInfer<Prettify<ModelData & ModelId & ModelParentId>>): NoInfer<DbModel>;
  };

  /**
   * Phantom types
   * These fields are only accessible at type-level, and actually it will be undefined at runtime
   */
  $dbModel: DbModel;
  $id: ModelId & ModelParentId;
  $parentId: ModelParentId;
  $model: Prettify<ModelData & ModelId & ModelParentId>;
};

export type ModelIdSchema<ModelId extends Record<string, unknown> = Record<string, unknown>> = {
  from(id: string): ModelId;
  to(id: ModelId): string;
};

export const docPath = <T extends CollectionSchema>(schema: T, id: T['$id']): string => {
  const docId = schema.id.to(id);
  return `${collectionPath(schema, id)}/${docId}`;
};

export const collectionPath = <T extends CollectionSchema>(
  schema: T,
  id: T['$parentId'],
): string => {
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
   * Get a document by ID
   */
  get(id: T['$id'], options?: TransactionOption<Env>): Promise<T['$model'] | undefined>;

  /**
   * Create a new document
   * @throws If the document already exists
   */
  create(doc: T['$model'], options?: WriteTransactionOption<Env>): Promise<void>;

  /**
   * Create or update
   */
  set(doc: T['$model'], options?: WriteTransactionOption<Env>): Promise<void>;

  /**
   * Delete a document by ID
   */
  delete(id: T['$id'], options?: WriteTransactionOption<Env>): Promise<void>;

  /**
   * Get documents by multiple ID
   * example: [{id:1},{id:2},{id:5},{id:1}] -> [doc1,doc2,undefined,doc1]
   */
  batchGet(ids: T['$id'][], options?: TransactionOption<Env>): Promise<(T['$model'] | undefined)[]>;

  /**
   * Create or update multiple documents
   * The entire operation will fail if one creation fails
   */
  batchCreate(docs: T['$model'][], options?: WriteTransactionOption<Env>): Promise<void>;

  /**
   * Create or update multiple documents
   * Up to 500 documents
   */
  batchSet(docs: T['$model'][], options?: WriteTransactionOption<Env>): Promise<void>;

  /**
   * Delete documents by multiple ID
   * Up to 500 documents
   */
  batchDelete(ids: T['$id'][], options?: WriteTransactionOption<Env>): Promise<void>;

  // TODO
  query(parentId: T['$parentId']): Promise<T['$model'][]>;
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
  | Map;

export type Timestamp = sdk.Timestamp | admin.Timestamp;
export type DocumentReference = sdk.DocumentReference | admin.DocumentReference;
export type GeoPoint = sdk.GeoPoint | admin.GeoPoint;
export type Map = { [K in string]: ValueType };
