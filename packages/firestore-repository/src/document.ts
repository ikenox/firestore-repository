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

/**
 * A common part of firebase-js-sdk and firestore-admin Timestamp class
 */
export type Timestamp = {
  readonly seconds: number;
  readonly nanoseconds: number;
  toDate(): Date;
  toMillis(): number;
  isEqual(other: Timestamp): boolean;
  valueOf(): string;
};

/**
 * A representation of bytes type
 */
export type Bytes =
  // admin
  | Uint8Array
  // js-sdk
  | { toUint8Array(): Uint8Array; toBase64(): string };

/**
 * A common part of firebase-js-sdk and firestore-admin DocumentReference class
 */
export type DocumentReference = {
  id: string;
  path: string;
  withConverter(...args: unknown[]): unknown;
};

/**
 * A common part of firebase-js-sdk and firestore-admin GeoPoint class
 */
export type GeoPoint = {
  latitude: number;
  longitude: number;
  isEqual(other: GeoPoint): boolean;
};

/**
 * A common part of firebase-js-sdk and firestore-admin VectorValue class
 */
export type VectorValue = {
  toArray(): number[];
  isEqual(other: VectorValue): boolean;
};

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
export type WriteDocumentData<T extends DocumentData = DocumentData> = {
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
