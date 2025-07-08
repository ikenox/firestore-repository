import type * as firestore from '@firebase/firestore';
import type {
  Bytes,
  DocumentReference,
  GeoPoint,
  Timestamp,
  VectorValue,
} from 'firestore-repository/document';

export function wrap(v: firestore.Timestamp): Timestamp;
export function wrap(v: firestore.GeoPoint): GeoPoint;
export function wrap(v: firestore.DocumentReference): DocumentReference;
export function wrap(v: firestore.VectorValue): VectorValue;
export function wrap(v: firestore.Bytes): Bytes;
export function wrap(
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

export function unwrap(v: Timestamp): firestore.Timestamp;
export function unwrap(v: GeoPoint): firestore.GeoPoint;
export function unwrap(v: DocumentReference): firestore.DocumentReference;
export function unwrap(v: VectorValue): firestore.VectorValue;
export function unwrap(v: Bytes): firestore.Bytes;
export function unwrap(
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
