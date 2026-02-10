import type { Equal } from './util.js';

/**
 * The type of Firestore document data
 */
export type DocumentData = MapValue;

/**
 * The type of a Firestore field value
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

/** An object/map value type where keys are strings and values are any Firestore value type */
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
 * A platform-agnostic representation of the Timestamp type, compatible with both firebase-js-sdk and firebase-admin
 */
export type Timestamp = { [timestampBrand]: unknown };

/**
 * A platform-agnostic representation of the Bytes type
 */
export type Bytes = { [bytesBrand]: unknown };

/**
 * A platform-agnostic representation of the DocumentReference type, compatible with both firebase-js-sdk and firebase-admin
 */
export type DocumentReference = { [docRefBrand]: unknown };

/**
 * A platform-agnostic representation of the GeoPoint type, compatible with both firebase-js-sdk and firebase-admin
 */
export type GeoPoint = { [getPointBrand]: unknown };

/**
 * A platform-agnostic representation of the VectorValue type, compatible with both firebase-js-sdk and firebase-admin
 */
export type VectorValue = { [vectorValueBrand]: unknown };

/**
 * A write-only value that is replaced with the current time on the server side
 */
export type ServerTimestamp = { [serverTimestampBrand]: unknown };

/**
 * A write-only value that increments the specified field value
 */
export type Increment = { [incrementBrand]: unknown };

/**
 * A write-only value that appends the specified items to an array field
 */
export type ArrayUnion = { [arrayUnionBrand]: unknown };

/**
 * A write-only value that removes the specified items from an array field
 */
export type ArrayRemove = { [arrayRemoveBrand]: unknown };

/**
 * A type-safe field path of a document
 */
export type FieldPath<T extends DocumentData = DocumentData> =
  | { [K in keyof T & string]: K | `${K}.${ValueFieldPath<T[K]>}` }[keyof T & string]
  | '__name__';
/** Nested field paths for map values, used recursively by {@link FieldPath} */
export type ValueFieldPath<T extends ValueType> = T extends MapValue
  ? { [K in keyof T & string]: K | `${K}.${ValueFieldPath<T[K]>}` }[keyof T & string]
  : never;

/**
 * The type of a field value at the specified path
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
 * The type of data that can be written to Firestore, which is a superset of `DocumentData`.
 * For example, a `Date` value can be used for a `Timestamp` field when writing document data.
 * This reduces boilerplate code for type conversion.
 */
export type WriteDocumentData<T extends DocumentData = DocumentData> = WriteValue<T>;

/**
 * The writable value type for a field of the specified value type
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
 * Maps `[ValueType1, ValueType2, ...]` to `[WriteValue1, WriteValue2, ...]` at the type level
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
