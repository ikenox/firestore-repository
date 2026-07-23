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
import { filterOperand, type WhereFilterOp } from 'firestore-repository/query';
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
 * Builds the encoder for filter-condition operands, memoizing the operand
 * schema per (field path, operator) like `buildEncodeSchema` builds the
 * write schema once per collection. The operand schema reuses the write
 * codec (`buildEncodeField`): a field's READ representation is a subset of
 * its write `input` for every descriptor, and the write conversions
 * (`RefPath` -> `DocumentReference`, `Date` -> `Timestamp`,
 * geopoint/bytes/vector to their SDK classes) are exactly the operand forms
 * `where()` compares correctly. Sending references as `DocumentReference`
 * values also keeps `__name__` filters free of the SDK's scope-dependent
 * string conventions (see docs/querying-by-document-id.md): a reference
 * works in every scope. The operand's shape per operator (`in` takes a list
 * of field values, `array-contains` an element, ...) comes from
 * `filterOperand`, the runtime counterpart of the `FilterOperand` type.
 */
export function buildEncodeFilterValue(
  schema: DocumentSchema,
  db: Firestore,
): (fieldPath: string, opStr: WhereFilterOp, value: unknown) => unknown {
  const operandSchemas = new Map<string, ZodAny>();
  return (fieldPath, opStr, value) => {
    const key = `${opStr}:${fieldPath}`;
    let operandSchema = operandSchemas.get(key);
    if (operandSchema === undefined) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `fieldPath` comes from a filter already typed against the schema
      const fieldType = fieldTypeOfPath(schema, fieldPath as DocFieldPath<DocumentSchema>);
      operandSchema = buildEncodeField(filterOperand(fieldType, opStr), db);
      operandSchemas.set(key, operandSchema);
    }
    return operandSchema.parse(value);
  };
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
