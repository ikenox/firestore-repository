import {
  type DocumentReference,
  type Timestamp,
  type GeoPoint,
} from 'firebase-admin/firestore';

/**
 * Firestoreコレクションの定義
 */
export type CollectionSchema<
  Id extends Record<string, string | number> = Record<string, string | number>,
  ParentId extends IdFields = Record<never, never>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  Data = DocumentData,
> = {
  name: string;
  /**
   * root collectionの場合はundefinedを返却
   * subcollectionの場合は親のドキュメントのパスを返却
   */
  parentPath(data: ParentId): string | undefined;
  docId(data: Id): string;
};

export const collection = <
  Id extends IdFields,
  Data extends DocumentData,
  ParentId extends IdFields = Record<never, never>,
>(
  name: string,
  params: {
    docId: (id: Id) => string;
    parentId?: (parentId: ParentId) => string;
    // 型情報を後置で指定できるように用意しているphantom type的なもの
    data: DataSchema<Data>;
  }
): CollectionSchema<Id, ParentId, Data> => ({
  name,
  docId: params.docId,
  parentPath: params.parentId ?? (() => undefined),
});

/**
 * 型情報を後置で指定できるように用意しているphantom type的なもの
 */
export type DataSchema<T extends DocumentData> = T[];
export const schema = <T extends DocumentData>(): DataSchema<T> => [];

export type DocId<T> =
  T extends CollectionSchema<infer Id> ? Id & CollectionPath<T> : never;

export type CollectionPath<T> =
  T extends CollectionSchema<IdFields, infer ParentId> ? ParentId : never;

export type DocData<T> =
  T extends CollectionSchema<IdFields, IdFields, infer Data> ? Data : never;

/**
 * ドキュメントのID
 */
export type IdFields = Record<string, string | number>;

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
export type Map = { [K in string]: ValueType };
