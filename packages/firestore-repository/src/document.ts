import type { Equal } from './util.js';

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
  | ValueType[]
  | MapValue
  | Timestamp
  | Bytes
  | DocumentReference
  | GeoPoint
  | VectorValue;

export type MapValue = { [key: string]: ValueType };

export const timestampBrand: unique symbol = Symbol();
export const bytesBrand: unique symbol = Symbol();
export const docRefBrand: unique symbol = Symbol();
export const getPointBrand: unique symbol = Symbol();
export const vectorValueBrand: unique symbol = Symbol();
export const serverTimestampBrand: unique symbol = Symbol();
export const incrementBrand: unique symbol = Symbol();
export const arrayUnionBrand: unique symbol = Symbol();
export const arrayRemoveBrand: unique symbol = Symbol();

/**
 * A common part of firebase-js-sdk and firestore-admin Timestamp class
 */
export type Timestamp = { [timestampBrand]: unknown };

/**
 * A representation of bytes type
 */
export type Bytes = { [bytesBrand]: unknown };

/**
 * A common part of firebase-js-sdk and firestore-admin DocumentReference class
 */
export type DocumentReference = { [docRefBrand]: unknown };

/**
 * A common part of firebase-js-sdk and firestore-admin GeoPoint class
 */
export type GeoPoint = { [getPointBrand]: unknown };

/**
 * A common part of firebase-js-sdk and firestore-admin VectorValue class
 */
export type VectorValue = { [vectorValueBrand]: unknown };

/**
 * A write-only value that is replaced with current time on the server-side
 */
export type ServerTimestamp = { [serverTimestampBrand]: unknown };

/**
 * A write-only value that increments the specified field value
 */
export type Increment = { [incrementBrand]: unknown };

/**
 * A write-only value that appends the specified items into the array field
 */
export type ArrayUnion = { [arrayUnionBrand]: unknown };

/**
 * A write-only value that removes the specified items from the array field
 */
export type ArrayRemove = { [arrayRemoveBrand]: unknown };

/**
 * Field path of the document
 */
export type FieldPath<T extends DocumentData = DocumentData> =
  | { [K in keyof T & string]: K | `${K}.${ValueFieldPath<T[K]>}` }[keyof T & string]
  | '__name__';
export type ValueFieldPath<T extends ValueType> = T extends MapValue
  ? { [K in keyof T & string]: K | `${K}.${ValueFieldPath<T[K]>}` }[keyof T & string]
  : never;

/**
 * Type of the specified field value
 */
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

/**
 * `WriteDocumentData` is the type of the data that can be written to firestore, which is a superset of `DocumentData`.
 * For example, `Date` value can be placed on `Timestamp` field when writing the document data.
 * It's reduces boilerplate code of type conversion.
 */
export type WriteDocumentData<T extends DocumentData = DocumentData> = WriteValue<T>;

/**
 * Obtains writable value for a field of the specified value type
 */
export type WriteValue<T extends ValueType> = T extends Timestamp
  ? Date | Timestamp | ServerTimestamp
  : T extends Bytes | DocumentReference | GeoPoint | VectorValue
    ? T
    :
        | (T extends MapValue ? { [K in keyof T]: WriteValue<T[K]> } : never)
        | (T extends ValueType[] ? MapArrayToWriteValue<T> : never)
        | (T extends ValueType[]
            ? Equal<T['length'], number> extends true
              ? ArrayUnion | ArrayRemove
              : never
            : never)
        | (T extends number ? (Equal<T, number> extends true ? Increment : never) : never)
        | (T extends number | string | null | boolean ? T : never);

/**
 * Map `[ValueType1, ValueType2, ...]` into `[WriteValue1, WriteValue1, ...]` at type-level
 */
export type MapArrayToWriteValue<T extends ValueType[]> = T extends [
  infer A extends ValueType,
  ...infer B extends ValueType[],
]
  ? [WriteValue<A>, ...MapArrayToWriteValue<B>]
  : T extends []
    ? []
    : T extends (infer A extends ValueType)[]
      ? WriteValue<A>[]
      : never;
