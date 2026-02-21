import type * as firestore from '@firebase/firestore';
import type {
  Bytes,
  DocumentReference,
  GeoPoint,
  Timestamp,
  VectorValue,
} from 'firestore-repository/document';

/** Serializes a Firebase JS SDK value type into its platform-agnostic branded type */
export function serialize(v: firestore.Timestamp): Timestamp;
export function serialize(v: firestore.GeoPoint): GeoPoint;
export function serialize(v: firestore.DocumentReference): DocumentReference;
export function serialize(v: firestore.VectorValue): VectorValue;
export function serialize(v: firestore.Bytes): Bytes;
export function serialize(
  v:
    | firestore.Timestamp
    | firestore.GeoPoint
    | firestore.DocumentReference
    | firestore.VectorValue
    | firestore.Bytes,
): Timestamp | GeoPoint | DocumentReference | VectorValue | Bytes {
  // @ts-expect-error
  return v;
}

/** Deserializes a platform-agnostic branded type back into its Firebase JS SDK value type */
export function deserialize(v: Timestamp): firestore.Timestamp;
export function deserialize(v: GeoPoint): firestore.GeoPoint;
export function deserialize(v: DocumentReference): firestore.DocumentReference;
export function deserialize(v: VectorValue): firestore.VectorValue;
export function deserialize(v: Bytes): firestore.Bytes;
export function deserialize(
  v: Timestamp | GeoPoint | DocumentReference | VectorValue | Bytes,
):
  | firestore.Timestamp
  | firestore.GeoPoint
  | firestore.DocumentReference
  | firestore.VectorValue
  | firestore.Bytes {
  // @ts-expect-error
  return v;
}
