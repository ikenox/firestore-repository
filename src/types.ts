import type * as admin from 'firebase-admin/firestore';
import type * as sdk from 'firebase/firestore';

/**
 * An entrypoint of schema definition
 */
export const collection = <
  DbModel extends DocumentData,
  AppModel,
  IdKeys extends (keyof AppModel)[],
  ParentIdKeys extends (keyof AppModel)[] = never,
>(
  schema: Omit<
    CollectionSchema<DbModel, AppModel, IdKeys, ParentIdKeys>,
    // Omit fields for a phantom type
    `\$${string}`
  >,
): CollectionSchema<DbModel, AppModel, IdKeys, ParentIdKeys> =>
  schema as CollectionSchema<DbModel, AppModel, IdKeys, ParentIdKeys>;

/**
 * A definition of firestore collection
 */
export type CollectionSchema<
  DbModel extends DocumentData = DocumentData,
  AppModel = Record<string, unknown>,
  IdKeys extends (keyof AppModel)[] = (keyof AppModel)[],
  ParentIdKeys extends (keyof AppModel)[] = never,
> = {
  name: string;
  fromFirestore(
    data: DbModel,
    id: string,
    // TODO more type-safety
    collectionPath: string[],
  ): AppModel;
  // TODO only allow exact type
  toFirestore(data: NoInfer<AppModel>): NoInfer<DbModel>;
  id: {
    keys: IdKeys;
    serialize(keys: Pick<AppModel, IdKeys[number]>): string;
  };
  /**
   * Define if the collection is a subcollection
   */
  parent?: {
    keys: ParentIdKeys;
    path(keys: Pick<AppModel, ParentIdKeys[number]>): string;
  };

  /**
   * Phantom types
   * These fields are only accessible at type-level, and actually it will be undefined at runtime
   */
  $dbModel: DbModel;
  $model: AppModel;
  $id: Pick<AppModel, IdKeys[number]>;
  $parentDocId: Pick<AppModel, ParentIdKeys[number]>;
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
