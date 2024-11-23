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
    // Omit fields for a phantom type
    `\$${string}`
  >,
): CollectionSchema<DbModel, Parent, ModelData, ModelId, ModelParentId> =>
  schema as CollectionSchema<DbModel, Parent, ModelData, ModelId, ModelParentId>;

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
  id: {
    from(id: string): ModelId;
    to(id: ModelId): string;
  };
  parent?: {
    schema: Parent;
    from(id: Parent['$id']): ModelParentId;
    to(id: ModelParentId): Parent['$id'];
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
  $id: ModelId;
  $parentId: ModelParentId;
  $model: Prettify<ModelData & ModelId & ModelParentId>;
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
    ? `${docPath(schema.parent.schema, id)}/${schema.name}`
    : schema.name;
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
