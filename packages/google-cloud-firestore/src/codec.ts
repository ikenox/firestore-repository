import type * as firestore from '@google-cloud/firestore';
import {
  DocumentReference as FirestoreDocumentReference,
  FieldValue,
  GeoPoint as FirestoreGeoPoint,
  Timestamp as FirestoreTimestamp,
  VectorValue as FirestoreVectorValue,
} from '@google-cloud/firestore';
import { documentPath } from 'firestore-repository/path';
import type { DocRef } from 'firestore-repository/repository';
import type {
  ArrayType,
  Collection,
  DocRefType,
  DocumentSchema,
  FieldType,
  LiteralType,
  MapType,
  UnionType,
} from 'firestore-repository/schema';
import { _optional, serverOperation } from 'firestore-repository/schema';
import { assertNever } from 'firestore-repository/util';
import * as z from 'zod';

// oxlint-disable-next-line typescript/no-explicit-any
type ZodAny = z.ZodType<any, any>;

const isServerOp = (v: unknown, op: string): boolean =>
  v != null && typeof v === 'object' && Reflect.get(v, serverOperation) === op;

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
      return z.instanceof(Buffer).transform((b) => new Uint8Array(b));
    case 'timestamp':
      return z.instanceof(FirestoreTimestamp).transform((ts) => ts.toDate());
    case 'geoPoint':
      return z
        .instanceof(FirestoreGeoPoint)
        .transform((gp) => ({ latitude: gp.latitude, longitude: gp.longitude }));
    case 'vector':
      // oxlint-disable-next-line typescript/no-explicit-any
      return z
        .custom<any>((v) => v instanceof FirestoreVectorValue)
        .transform((vv) => vv.toArray());
    case 'docRef':
      // oxlint-disable-next-line typescript/no-explicit-any
      return z
        .custom<any>((v) => v instanceof FirestoreDocumentReference)
        .transform((ref) => {
          const ids: string[] = [];
          let current: firestore.DocumentReference | null = ref;
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
  db: firestore.Firestore,
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

function buildEncodeField(fieldType: FieldType, db: firestore.Firestore): ZodAny {
  switch (fieldType.type) {
    case 'string':
      return z.string();
    case 'bool':
      return z.boolean();
    case 'null':
      return z.null();
    case 'bytes':
      return z.instanceof(Uint8Array).transform((b) => Buffer.from(b));
    case 'geoPoint':
      return z
        .object({ latitude: z.number(), longitude: z.number() })
        .transform((gp) => new FirestoreGeoPoint(gp.latitude, gp.longitude));
    case 'vector':
      return z.array(z.number()).transform((arr) => FieldValue.vector(arr));
    case 'int64':
    case 'double':
      return zodUnion([
        // oxlint-disable-next-line typescript/no-explicit-any
        z
          .custom<any>((v) => isServerOp(v, 'increment'))
          .transform((v: any) => FieldValue.increment(v.amount)),
        z.number(),
      ]);
    case 'timestamp':
      return zodUnion([
        // oxlint-disable-next-line typescript/no-explicit-any
        z
          .custom<any>((v) => isServerOp(v, 'serverTimestamp'))
          .transform(() => FieldValue.serverTimestamp()),
        z.date().transform((d) => FirestoreTimestamp.fromDate(d)),
      ]);
    case 'docRef': {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const ft = fieldType as DocRefType<Collection>;
      return z.array(z.string()).transform((ref) =>
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        db.doc(documentPath(ft.collection, ref as DocRef<Collection>)),
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
        // oxlint-disable-next-line typescript/no-explicit-any
        z
          .custom<any>((v) => isServerOp(v, 'arrayRemove'))
          .transform((v: any) => FieldValue.arrayRemove(...v.values)),
        // oxlint-disable-next-line typescript/no-explicit-any
        z
          .custom<any>((v) => isServerOp(v, 'arrayUnion'))
          .transform((v: any) => FieldValue.arrayUnion(...v.values)),
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
