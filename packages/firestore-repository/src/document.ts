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
  | Uint8Array
  // | DocumentReference
  // | GeoPoint
  | ValueType[]
  | MapValue;
export type Timestamp = {
  // a common parts of sdk.Timestamp and admin.Timestamp
  toDate(): Date;
};
// export type DocumentReference = sdk.DocumentReference | admin.DocumentReference;
// export type GeoPoint = sdk.GeoPoint | admin.GeoPoint;
export type MapValue = { [key: string]: ValueType };
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
  | (T extends number | string | null | boolean | Uint8Array ? T : never);
export type MapArray<T> = T extends [infer A extends ValueType, ...infer B extends ValueType[]]
  ? [WriteValue<A>, ...MapArray<B>]
  : T extends []
    ? []
    : T extends (infer A extends ValueType)[]
      ? WriteValue<A>[]
      : never;
