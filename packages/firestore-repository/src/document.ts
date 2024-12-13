import type * as jsSdk from '@firebase/firestore';
import type * as admin from '@google-cloud/firestore';

/**
 * Type of firestore document data
 */
export type DocumentData = MapValue;

/**
 * Type of firestore field value
 */
export type ValueType =
  | boolean
  | number
  | string
  | null
  | Timestamp
  | Bytes
  | DocumentReference
  | GeoPoint
  | VectorValue
  | ValueType[]
  | MapValue;
export type Timestamp = admin.Timestamp | jsSdk.Timestamp;
export type Bytes = Buffer | jsSdk.Bytes;
export type DocumentReference = jsSdk.DocumentReference | admin.DocumentReference;
export type GeoPoint = jsSdk.GeoPoint | admin.GeoPoint;
export type VectorValue = jsSdk.VectorValue | admin.VectorValue;
export type MapValue = { [key: string]: ValueType };

/**
 * Field path of the document
 */
export type FieldPath<T extends DocumentData = DocumentData> =
  | { [K in keyof T & string]: K | `${K}.${ValueFieldPath<T[K]>}` }[keyof T & string]
  | '__name__';
export type ValueFieldPath<T extends ValueType> = T extends MapValue
  ? { [K in keyof T & string]: K | `${K}.${ValueFieldPath<T[K]>}` }[keyof T & string]
  : never;
export type FieldValue<T extends DocumentData, U extends FieldPath<T>> = U extends keyof T
  ? Exclude<T[U], undefined>
  : U extends '__name__'
    ? string
    : U extends `${infer P}.${infer R}`
      ? P extends keyof T
        ? T[P] extends MapValue
          ? FieldValue<T[P], R>
          : T[P]
        : never
      : never;
export type WriteModel<T extends DocumentData> = {
  [K in keyof T]: WriteValue<T[K]>;
};
export type WriteValue<T extends ValueType> =
  | (T extends Timestamp ? Date | Timestamp : never)
  | (T extends MapValue ? { [K in keyof T]: WriteValue<T[K]> } : never)
  | (T extends ValueType[] ? MapArray<T> : never)
  | (T extends number | string | null | boolean | Bytes | DocumentReference | GeoPoint | VectorValue
      ? T
      : never);
export type MapArray<T> = T extends [infer A extends ValueType, ...infer B extends ValueType[]]
  ? [WriteValue<A>, ...MapArray<B>]
  : T extends []
    ? []
    : T extends (infer A extends ValueType)[]
      ? WriteValue<A>[]
      : never;
