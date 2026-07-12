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
import type { Collection, DocumentSchema, FieldType } from 'firestore-repository/schema';
import {
  isArrayRemove,
  isArrayUnion,
  isIncrement,
  isServerTimestamp,
} from 'firestore-repository/server-value';
import { assertNever } from 'firestore-repository/util';
import * as z from 'zod';

// oxlint-disable-next-line typescript/no-explicit-any
type ZodAny = z.ZodType<any, any>;

export const isBytes = (v: unknown) => v instanceof FirestoreBytes;
export const isDocumentReference = (v: unknown) => v instanceof FirestoreDocumentReference;

export function buildDecodeSchema(schema: DocumentSchema): z.ZodObject<z.ZodRawShape> {
  return z.object(
    Object.fromEntries(
      Object.entries(schema).map(([k, v]) => {
        const s = buildDecodeField(v);
        return [k, v.optional ? s.optional() : s];
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
        .unknown()
        .refine(isBytes)
        .transform((b) => b.toUint8Array());
    case 'timestamp':
      return z.instanceof(FirestoreTimestamp).transform((ts) => ts.toDate());
    case 'geoPoint':
      return z
        .instanceof(FirestoreGeoPoint)
        .transform((gp) => ({ latitude: gp.latitude, longitude: gp.longitude }));
    case 'vector':
      return z.instanceof(FirestoreVectorValue).transform((vv) => vv.toArray());
    case 'docRef':
      return z
        .unknown()
        .refine(isDocumentReference)
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
      return z.object(
        Object.fromEntries(
          Object.entries(fieldType.fields).map(([k, v]) => {
            const s = buildDecodeField(v);
            return [k, v.optional ? s.optional() : s];
          }),
        ),
      );
    }
    case 'array': {
      return z.array(buildDecodeField(fieldType.dynamicPart));
    }
    case 'union': {
      return zodUnion(fieldType.elements.map(buildDecodeField));
    }
    case 'const': {
      return zodUnion(fieldType.values.map((v) => z.literal(v)));
    }
    default:
      return assertNever(fieldType);
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
        return [k, v.optional ? s.optional() : s];
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
        z.number(),
        z
          .unknown()
          .refine(isIncrement)
          .transform((v) => firestoreIncrement(v.amount)),
      ]);
    case 'timestamp':
      return zodUnion([
        z.date().transform((d) => FirestoreTimestamp.fromDate(d)),
        z
          .unknown()
          .refine(isServerTimestamp)
          .transform(() => firestoreServerTimestamp()),
      ]);
    case 'docRef': {
      return z.array(z.string()).transform((ref) =>
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        doc(db, documentPath(fieldType.collection, ref as DocRef<Collection>)),
      );
    }
    case 'map': {
      return z.object(
        Object.fromEntries(
          Object.entries(fieldType.fields).map(([k, v]) => {
            const s = buildEncodeField(v, db);
            return [k, v.optional ? s.optional() : s];
          }),
        ),
      );
    }
    case 'array': {
      return zodUnion([
        z.array(buildEncodeField(fieldType.dynamicPart, db)),
        z
          .unknown()
          .refine(isArrayRemove)
          .transform((v) => firestoreArrayRemove(...v.values)),
        z
          .unknown()
          .refine(isArrayUnion)
          .transform((v) => firestoreArrayUnion(...v.values)),
      ]);
    }
    case 'union': {
      return zodUnion(fieldType.elements.map((e) => buildEncodeField(e, db)));
    }
    case 'const': {
      return zodUnion(fieldType.values.map((v) => z.literal(v)));
    }
    default:
      return assertNever(fieldType);
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
