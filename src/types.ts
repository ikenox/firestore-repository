import type * as admin from 'firebase-admin/firestore';
import type * as sdk from 'firebase/firestore';

/**
 * An entrypoint of schema definition
 */
export const collection = <
  DbModel extends DocumentData,
  AppModel,
  IdKeys extends (keyof AppModel)[],
  Parent extends CollectionSchema = never,
>(
  schema: Omit<
    CollectionSchema<DbModel, AppModel, IdKeys, Parent>,
    // Omit fields for a phantom type
    `\$${string}`
  >,
): CollectionSchema<DbModel, AppModel, IdKeys, Parent> =>
  schema as CollectionSchema<DbModel, AppModel, IdKeys, Parent>;

/**
 * A definition of firestore collection
 */
export type CollectionSchema<
  DbModel extends DocumentData = DocumentData,
  AppModel = Record<string, unknown>,
  IdKeys extends (keyof AppModel)[] = (keyof AppModel)[],
  Parent extends CollectionSchema = never,
> = {
  name: string;
  fromFirestore(data: DbModel, id: string, collectionPath: PathParams<Parent>): AppModel;
  // TODO only allow exact type
  toFirestore(data: NoInfer<AppModel>): NoInfer<DbModel>;
  id: {
    keys: IdKeys;
    docId(keys: Pick<AppModel, IdKeys[number]>): string;
  };
  /**
   * Define if the collection is a subcollection
   */
  parent?: Parent;

  /**
   * Phantom types
   * These fields are only accessible at type-level, and actually it will be undefined at runtime
   */
  $dbModel: DbModel;
  $model: AppModel;
  $id: Pick<AppModel, IdKeys[number]>;
  $collectionPath: PathParams<Parent>;
};

/**
 * A full path parameters of the collection
 */
export type PathParams<T extends CollectionSchema> = [T] extends [never]
  ? []
  : [
      // T['$id'],
      string, // TODO more type-safety
      ...T['$collectionPath'],
    ];

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
