import {
  Bytes as FirestoreBytes,
  DocumentReference as FirestoreDocumentReference,
  Firestore,
  GeoPoint as FirestoreGeoPoint,
  Timestamp as FirestoreTimestamp,
  VectorValue as FirestoreVectorValue,
  arrayRemove as firestoreArrayRemove,
  arrayUnion as firestoreArrayUnion,
  doc,
  increment as firestoreIncrement,
  serverTimestamp as firestoreServerTimestamp,
  vector,
} from '@firebase/firestore';
import { documentPath } from 'firestore-repository/path';
import type { DocRef } from 'firestore-repository/repository';
import type {
  ArrayRemove,
  ArrayType,
  ArrayUnion,
  Collection,
  DocRefType,
  DocumentSchema,
  FieldType,
  Increment,
  LiteralType,
  MapType,
  ServerTimestamp,
  UnionType,
} from 'firestore-repository/schema';
import { _optional, serverOperation } from 'firestore-repository/schema';
import { assertNever } from 'firestore-repository/util';
import * as z from 'zod';

// oxlint-disable-next-line typescript/no-explicit-any
type ZodAny = z.ZodType<any, any>;

const hasServerOp = (v: unknown, op: string): boolean =>
  v != null && typeof v === 'object' && Reflect.get(v, serverOperation) === op;

const isIncrement = (v: unknown): v is Increment => hasServerOp(v, 'increment');
const isServerTimestamp = (v: unknown): v is ServerTimestamp => hasServerOp(v, 'serverTimestamp');
const isArrayRemove = (v: unknown): v is ArrayRemove<unknown> => hasServerOp(v, 'arrayRemove');
const isArrayUnion = (v: unknown): v is ArrayUnion<unknown> => hasServerOp(v, 'arrayUnion');

export function buildDecodeSchema(schema: DocumentSchema): z.ZodObject<z.ZodRawShape> {
  return z.object(
    Object.fromEntries(
      Object.entries(schema).map(([k, v]) => {
        const s = buildDecodeField(v);
        return [k, v[_optional] ? s.optional() : s];
      }),
    ),
  );
}

function buildDecodeField(fieldType: FieldType): ZodAny {
  switch (fieldType.type) {
    case 'string':
      return z.string();
    case 'bool':
      return z.boolean();
    case 'int64':
    case 'double':
      return z.number();
    case 'null':
      return z.null();
    case 'bytes':
      return z
        .custom<FirestoreBytes>((v) => v instanceof FirestoreBytes)
        .transform((b) => b.toUint8Array());
    case 'timestamp':
      return z
        .custom<FirestoreTimestamp>((v) => v instanceof FirestoreTimestamp)
        .transform((ts) => ts.toDate());
    case 'geoPoint':
      return z
        .custom<FirestoreGeoPoint>((v) => v instanceof FirestoreGeoPoint)
        .transform((gp) => ({ latitude: gp.latitude, longitude: gp.longitude }));
    case 'vector':
      return z
        .custom<FirestoreVectorValue>((v) => v instanceof FirestoreVectorValue)
        .transform((vv) => vv.toArray());
    case 'docRef':
      return z
        .custom<FirestoreDocumentReference>((v) => v instanceof FirestoreDocumentReference)
        .transform((ref) => {
          const ids: string[] = [];
          let current: FirestoreDocumentReference | null = ref;
          while (current != null) {
            ids.push(current.id);
            current = current.parent.parent;
          }
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion
          return ids.reverse() as DocRef<Collection>;
        });
    case 'map': {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const ft = fieldType as MapType;
      return z.object(
        Object.fromEntries(
          Object.entries(ft.fields).map(([k, v]) => {
            const s = buildDecodeField(v);
            return [k, v[_optional] ? s.optional() : s];
          }),
        ),
      );
    }
    case 'array': {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const ft = fieldType as ArrayType;
      return z.array(buildDecodeField(ft.dynamicPart));
    }
    case 'union': {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const ft = fieldType as UnionType;
      return zodUnion(ft.elements.map(buildDecodeField));
    }
    case 'const': {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const ft = fieldType as LiteralType<(string | number | boolean | null)[]>;
      return zodUnion(ft.values.map((v) => z.literal(v)));
    }
    default:
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return assertNever(fieldType as never);
  }
}

export function buildEncodeSchema(
  schema: DocumentSchema,
  db: Firestore,
): z.ZodObject<z.ZodRawShape> {
  return z.object(
    Object.fromEntries(
      Object.entries(schema).map(([k, v]) => {
        const s = buildEncodeField(v, db);
        return [k, v[_optional] ? s.optional() : s];
      }),
    ),
  );
}

function buildEncodeField(fieldType: FieldType, db: Firestore): ZodAny {
  switch (fieldType.type) {
    case 'string':
      return z.string();
    case 'bool':
      return z.boolean();
    case 'null':
      return z.null();
    case 'bytes':
      return z.instanceof(Uint8Array).transform((b) => FirestoreBytes.fromUint8Array(b));
    case 'geoPoint':
      return z
        .object({ latitude: z.number(), longitude: z.number() })
        .transform((gp) => new FirestoreGeoPoint(gp.latitude, gp.longitude));
    case 'vector':
      return z.array(z.number()).transform((arr) => vector(arr));
    case 'int64':
    case 'double':
      return zodUnion([
        z
          .unknown()
          .refine(isIncrement)
          .transform((v) => firestoreIncrement(v.amount)),
        z.number(),
      ]);
    case 'timestamp':
      return zodUnion([
        z
          .unknown()
          .refine(isServerTimestamp)
          .transform(() => firestoreServerTimestamp()),
        z.date().transform((d) => FirestoreTimestamp.fromDate(d)),
      ]);
    case 'docRef': {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const ft = fieldType as DocRefType<Collection>;
      return z.array(z.string()).transform((ref) =>
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        doc(db, documentPath(ft.collection, ref as DocRef<Collection>)),
      );
    }
    case 'map': {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const ft = fieldType as MapType;
      return z.object(
        Object.fromEntries(
          Object.entries(ft.fields).map(([k, v]) => {
            const s = buildEncodeField(v, db);
            return [k, v[_optional] ? s.optional() : s];
          }),
        ),
      );
    }
    case 'array': {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const ft = fieldType as ArrayType;
      return zodUnion([
        z
          .unknown()
          .refine(isArrayRemove)
          .transform((v) => firestoreArrayRemove(...v.values)),
        z
          .unknown()
          .refine(isArrayUnion)
          .transform((v) => firestoreArrayUnion(...v.values)),
        z.array(buildEncodeField(ft.dynamicPart, db)),
      ]);
    }
    case 'union': {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const ft = fieldType as UnionType;
      return zodUnion(ft.elements.map((e) => buildEncodeField(e, db)));
    }
    case 'const': {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const ft = fieldType as LiteralType<(string | number | boolean | null)[]>;
      return zodUnion(ft.values.map((v) => z.literal(v)));
    }
    default:
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return assertNever(fieldType as never);
  }
}

function zodUnion(schemas: ZodAny[]): ZodAny {
  if (schemas.length === 0) {
    throw new Error('union must have at least one element');
  }
  if (schemas.length === 1) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return schemas[0] as ZodAny;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return z.union(schemas as [ZodAny, ZodAny, ...ZodAny[]]);
}
