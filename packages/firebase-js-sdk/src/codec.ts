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
import type { WhereFilterOp } from 'firestore-repository/query';
import {
  type Collection,
  type DocFieldPath,
  type DocumentSchema,
  type FieldType,
  fieldTypeOfPath,
} from 'firestore-repository/schema';
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
      // Both flavors decode to the RefPath segment path — known/unknown is a
      // gradient of tuple precision, not a change of shape.
      return z
        .unknown()
        .refine(isDocumentReference)
        .transform((ref) => ref.path.split('/'));
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
      return refPathSchema(fieldType.collection).transform((segments) =>
        doc(db, segments.join('/')),
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

/**
 * Encodes a single filter condition's operand into what the SDK's `where()`
 * accepts. Only document references need conversion: they appear in
 * conditions as `RefPath` segment paths (a field's READ representation) and
 * are sent as `DocumentReference` values — the one representation the
 * backend compares. This also keeps `__name__` filters free of the SDK's
 * scope-dependent string conventions (a plain id for a collection query, a
 * full root-relative path for a collection group — see
 * docs/querying-by-document-id.md): a reference works in every scope.
 * `in`/`not-in` take a list of operands and `array-contains(-any)` take
 * element operands, so the arity/element type is resolved per operator.
 */
export function encodeFilterValue(
  schema: DocumentSchema,
  fieldPath: string,
  opStr: WhereFilterOp,
  value: unknown,
  db: Firestore,
): unknown {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `fieldPath` comes from a filter already typed against the schema
  const fieldType = fieldTypeOfPath(schema, fieldPath as DocFieldPath<DocumentSchema>);
  switch (opStr) {
    case 'in':
    case 'not-in':
      return Array.isArray(value) ? value.map((v) => encodeFilterOperand(fieldType, v, db)) : value;
    case 'array-contains':
      return fieldType.type === 'array'
        ? encodeFilterOperand(fieldType.dynamicPart, value, db)
        : value;
    case 'array-contains-any':
      return fieldType.type === 'array' && Array.isArray(value)
        ? value.map((v) => encodeFilterOperand(fieldType.dynamicPart, v, db))
        : value;
    case '==':
    case '!=':
    case '<':
    case '<=':
    case '>':
    case '>=':
      return encodeFilterOperand(fieldType, value, db);
    default:
      return assertNever(opStr);
  }
}

function encodeFilterOperand(fieldType: FieldType, value: unknown, db: Firestore): unknown {
  switch (fieldType.type) {
    case 'docRef': {
      const parsed = refPathSchema(fieldType.collection).safeParse(value);
      return parsed.success ? doc(db, parsed.data.join('/')) : value;
    }
    case 'array':
      return Array.isArray(value)
        ? value.map((v) => encodeFilterOperand(fieldType.dynamicPart, v, db))
        : value;
    case 'map':
      return typeof value === 'object' && value !== null
        ? Object.fromEntries(
            Object.entries(value).map(([k, v]) => {
              const f = fieldType.fields[k];
              return [k, f === undefined ? v : encodeFilterOperand(f, v, db)];
            }),
          )
        : value;
    case 'union': {
      // A reference is the only member type needing conversion, so a value is
      // converted iff it matches a docRef member's segment-path shape.
      for (const e of fieldType.elements) {
        if (e.type === 'docRef' && refPathSchema(e.collection).safeParse(value).success) {
          return encodeFilterOperand(e, value, db);
        }
      }
      return value;
    }
    case 'string':
    case 'bool':
    case 'int64':
    case 'double':
    case 'timestamp':
    case 'bytes':
    case 'geoPoint':
    case 'vector':
    case 'null':
    case 'const':
      return value;
    default:
      return assertNever(fieldType);
  }
}

/**
 * A zod schema for a `RefPath` segment path. A known collection's tuple shape
 * is exact — literal collection names at the even positions — while the
 * context-free flavor accepts any even-length segment path.
 */
function refPathSchema(collection: Collection | 'unknown'): z.ZodType<string[]> {
  if (collection === 'unknown') {
    return z
      .array(z.string())
      .refine((segments) => segments.length >= 2 && segments.length % 2 === 0, {
        message: 'a reference path must have an even number of segments',
      });
  }
  const names = [...collection.parent, collection.name];
  return z
    .array(z.string())
    .refine(
      (segments) =>
        segments.length === names.length * 2 && names.every((name, i) => segments[i * 2] === name),
      { message: `not a reference path of collection '${collection.name}'` },
    );
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
