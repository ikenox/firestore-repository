import type * as admin from 'firebase-admin/firestore';
import type * as sdk from 'firebase/firestore';

export const collection = <
  DbModel extends DocumentData,
  AppModel,
  IdKeys extends (keyof AppModel)[],
  ParentKeys extends (keyof AppModel)[] = never,
>(
  schema: Omit<
    CollectionSchema<DbModel, AppModel, IdKeys, ParentKeys>,
    // Omit fields for a phantom type
    `\$${string}`
  >,
): CollectionSchema<DbModel, AppModel, IdKeys, ParentKeys> => schema;

/**
 * A definition of firestore collection
 */
export interface CollectionSchema<
  DbModel extends DocumentData = DocumentData,
  AppModel = Record<string, unknown>,
  IdKeys extends (keyof AppModel)[] = (keyof AppModel)[],
  ParentKeys extends (keyof AppModel)[] = never,
> {
  name: string;
  fromFirestore(
    data: DbModel,
    id: string,
    // TODO more type-safety
    parentId?: string[],
  ): AppModel;
  id: {
    keys: IdKeys;
    docId(keys: Pick<AppModel, IdKeys[number]>): string;
  };
  /**
   * Define if the collection is a subcollection
   */
  parent?: {
    keys: ParentKeys;
    docId: (keys: Pick<AppModel, ParentKeys[number]>) => string;
  };

  /**
   * Phantom types
   */
  $dbModel: DbModel;
  $appModel: AppModel;
  $id: Pick<AppModel, IdKeys[number]>;
  $parentId: Pick<AppModel, ParentKeys[number]>;
}

/**
 * Firestoreドキュメントのデータ型
 */
export type DocumentData = {
  [key: string]: ValueType;
};

/**
 * Firestoreドキュメントのフィールド値
 * Timestampなどはサーバー(firebase-admin)の値である点に注意
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
