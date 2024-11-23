import type * as admin from 'firebase-admin/firestore';
import type * as sdk from 'firebase/firestore';

/**
 * An entrypoint of schema definition
 */
export const collection = <
  DbModel extends DocumentData = DocumentData,
  ModelData extends Record<string, unknown> = Record<string, unknown>,
  ModelId extends Record<string, unknown> = Record<string, unknown>,
  Parent extends CollectionSchema = never,
>(
  schema: Omit<
    CollectionSchema<DbModel, ModelData, ModelId, Parent>,
    // Omit fields for a phantom type
    `\$${string}`
  >,
): CollectionSchema<DbModel, ModelData, ModelId, Parent> =>
  schema as CollectionSchema<DbModel, ModelData, ModelId, Parent>;

/**
 * A definition of firestore collection
 */
export type CollectionSchema<
  DbModel extends DocumentData = DocumentData,
  ModelData extends Record<string, unknown> = Record<string, unknown>,
  ModelId extends Record<string, unknown> = Record<string, unknown>,
  Parent extends CollectionSchema = never,
> = {
  name: string;
  data: {
    from(data: DbModel): ModelData;
    // TODO allow Date etc.
    to(data: NoInfer<ModelData & ModelId>): DbModel;
  };
  id: {
    from(id: string, parent: Parent['$id']): ModelId;
    to(data: NoInfer<ModelId>): [string, Parent['$id']];
  };
  parent?: Parent;

  /**
   * Phantom types
   * These fields are only accessible at type-level, and actually it will be undefined at runtime
   */
  $dbModel: DbModel;
  $model: ModelData & ModelId;
  $id: ModelId;
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
