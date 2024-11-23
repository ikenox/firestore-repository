import type * as admin from 'firebase-admin/firestore';
import type * as sdk from 'firebase/firestore';

/**
 * An entrypoint of schema definition
 */
export const collection = <
  DbModel extends DocumentData = DocumentData,
  ModelData extends Record<string, unknown> = Record<string, unknown>,
  ModelId extends Record<string, unknown> = Record<string, unknown>,
  Parent extends CollectionSchema | undefined = undefined,
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
  Parent extends CollectionSchema | undefined = undefined,
> = {
  name: string;
  from: {
    data(data: DbModel): ModelData;
    id(id: string): ModelId;
  };
  to: {
    // TODO allow Date etc.
    data(data: NoInfer<ModelData & ModelId>): NoInfer<DbModel>;
    id(
      data: NoInfer<ModelData & ModelId>,
    ): [string, Parent extends CollectionSchema ? PathParams<Parent> : []];
  };
  parent?: Parent;

  /**
   * Phantom types
   * These fields are only accessible at type-level, and actually it will be undefined at runtime
   */
  $dbModel: DbModel;
  $model: ModelData & ModelId;
  $id: ModelId;
  $parentPath: Parent extends CollectionSchema ? PathParams<Parent> : [];
};

export type PathParams<T extends CollectionSchema> = [T['$id'], ...T['$parentPath']];

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
