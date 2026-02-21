import type * as firestore from '@google-cloud/firestore';
import type {
  Bytes,
  DocumentReference,
  GeoPoint,
  Timestamp,
  VectorValue,
} from 'firestore-repository/document';

/** Serializes a Google Cloud Firestore value type into its platform-agnostic branded type */
export function serialize(v: firestore.Timestamp): Timestamp;
export function serialize(v: firestore.GeoPoint): GeoPoint;
export function serialize(v: firestore.DocumentReference): DocumentReference;
export function serialize(v: firestore.VectorValue): VectorValue;
export function serialize(v: Buffer): Bytes;
export function serialize(
  v:
    | firestore.Timestamp
    | firestore.GeoPoint
    | firestore.DocumentReference
    | firestore.VectorValue
    | Buffer,
): Timestamp | GeoPoint | DocumentReference | VectorValue | Bytes {
  // @ts-expect-error
  return v;
}

/** Deserializes a platform-agnostic branded type back into its Google Cloud Firestore value type */
export function deserialize(v: Timestamp): firestore.Timestamp;
export function deserialize(v: GeoPoint): firestore.GeoPoint;
export function deserialize(v: DocumentReference): firestore.DocumentReference;
export function deserialize(v: VectorValue): firestore.VectorValue;
export function deserialize(v: Bytes): Buffer;
export function deserialize(
  v: Timestamp | GeoPoint | DocumentReference | VectorValue | Bytes,
):
  | firestore.Timestamp
  | firestore.GeoPoint
  | firestore.DocumentReference
  | firestore.VectorValue
  | Buffer {
  // @ts-expect-error
  return v;
}
