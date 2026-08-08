import type * as firestore from '@google-cloud/firestore';
import {
  DocumentReference as FirestoreDocumentReference,
  FieldValue,
  GeoPoint as FirestoreGeoPoint,
  Timestamp as FirestoreTimestamp,
  VectorValue as FirestoreVectorValue,
} from '@google-cloud/firestore';
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

export const isVectorValue = (v: unknown) => v instanceof FirestoreVectorValue;
export const isDocumentReference = (v: unknown) => v instanceof FirestoreDocumentReference;

/**
 * Built schemas, shared by every caller that names the same schema. Building
 * one walks the whole descriptor tree, which dominates the work of a repeated
 * conversion, and the callers that would otherwise hold the memo are built per
 * call by design (`toSdkQuery`, and a pipeline's row decoder).
 *
 * Decoding is database-independent, so it is cached against the schema alone.
 * Encoding is not: it turns a `RefPath` into a `DocumentReference` via
 * `db.doc(...)`, binding that `Firestore` instance into the schema, so two
 * databases cannot share one. Everything is held weakly and dies with the
 * schema (or, for the per-database half, with the database).
 */
const schemaCaches = new WeakMap<DocumentSchema, SchemaCache>();

type SchemaCache = {
  decode?: z.ZodObject<z.ZodRawShape>;
  perDb: WeakMap<firestore.Firestore, DbSchemaCache>;
};

type DbSchemaCache = { encode?: z.ZodObject<z.ZodRawShape>; operands: Map<string, ZodAny> };

const cacheFor = (schema: DocumentSchema): SchemaCache => {
  let cache = schemaCaches.get(schema);
  if (cache === undefined) {
    cache = { perDb: new WeakMap() };
    schemaCaches.set(schema, cache);
  }
  return cache;
};

const dbCacheFor = (schema: DocumentSchema, db: firestore.Firestore): DbSchemaCache => {
  const { perDb } = cacheFor(schema);
  let cache = perDb.get(db);
  if (cache === undefined) {
    cache = { operands: new Map() };
    perDb.set(db, cache);
  }
  return cache;
};

export function buildDecodeSchema(schema: DocumentSchema): z.ZodObject<z.ZodRawShape> {
  const cache = cacheFor(schema);
  cache.decode ??= z.object(
    Object.fromEntries(
      Object.entries(schema).map(([k, v]) => {
        const s = buildDecodeField(v);
        return [k, v.optional ? s.optional() : s];
      }),
    ),
  );
  return cache.decode;
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
    // The uninhabited descriptor admits no value, which `z.never()` states
    // directly: `array(neverType())` then validates the empty array and
    // nothing else, so the element schema is never actually applied.
    case 'never':
      return z.never();
    case 'bytes':
      return z.instanceof(Buffer).transform((b) => new Uint8Array(b));
    case 'timestamp':
      return z.instanceof(FirestoreTimestamp).transform((ts) => ts.toDate());
    case 'geoPoint':
      return z
        .instanceof(FirestoreGeoPoint)
        .transform((gp) => ({ latitude: gp.latitude, longitude: gp.longitude }));
    case 'vector':
      return z
        .unknown()
        .refine(isVectorValue)
        .transform((vv) => vv.toArray());
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
  db: firestore.Firestore,
): z.ZodObject<z.ZodRawShape> {
  const cache = dbCacheFor(schema, db);
  cache.encode ??= z.object(
    Object.fromEntries(
      Object.entries(schema).map(([k, v]) => {
        const s = buildEncodeField(v, db);
        return [k, v.optional ? s.optional() : s];
      }),
    ),
  );
  return cache.encode;
}

function buildEncodeField(fieldType: FieldType, db: firestore.Firestore): ZodAny {
  switch (fieldType.type) {
    case 'string':
      return z.string();
    case 'bool':
      return z.boolean();
    case 'null':
      return z.null();
    // The uninhabited descriptor admits no value, which `z.never()` states
    // directly: `array(neverType())` then validates the empty array and
    // nothing else, so the element schema is never actually applied.
    case 'never':
      return z.never();
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
        z.number(),
        z
          .unknown()
          .refine(isIncrement)
          .transform((v) => FieldValue.increment(v.amount)),
      ]);
    case 'timestamp':
      return zodUnion([
        z.date().transform((d) => FirestoreTimestamp.fromDate(d)),
        z
          .unknown()
          .refine(isServerTimestamp)
          .transform(() => FieldValue.serverTimestamp()),
      ]);
    case 'docRef': {
      return refPathSchema(fieldType.collection).transform((segments) =>
        db.doc(segments.join('/')),
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
      // All three branches encode through the SAME element schema: a server
      // operation carries element VALUES, so `arrayUnion(refPath(...))` has to
      // reach Firestore as a `DocumentReference` exactly like `[refPath(...)]`
      // does. Encoding only the plain-array branch would let one field hold two
      // representations of the same logical value, decodable in one case only.
      //
      // The elements are `.pipe`d rather than parsed inside the transform so a
      // bad element stays a zod issue carrying its index, instead of a nested
      // `ZodError` thrown from within the enclosing parse.
      const elements = z.array(buildEncodeField(fieldType.dynamicPart, db));
      return zodUnion([
        elements,
        z
          .unknown()
          .refine(isArrayRemove)
          .transform((v) => v.values)
          .pipe(elements)
          .transform((values) => FieldValue.arrayRemove(...values)),
        z
          .unknown()
          .refine(isArrayUnion)
          .transform((v) => v.values)
          .pipe(elements)
          .transform((values) => FieldValue.arrayUnion(...values)),
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
  db: firestore.Firestore,
): (fieldPath: string, opStr: WhereFilterOp, value: unknown) => unknown {
  const { operands } = dbCacheFor(schema, db);
  return (fieldPath, opStr, value) => {
    const key = `${opStr}:${fieldPath}`;
    let operandSchema = operands.get(key);
    if (operandSchema === undefined) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `fieldPath` comes from a filter already typed against the schema
      const fieldType = fieldTypeOfPath(schema, fieldPath as DocFieldPath<DocumentSchema>);
      operandSchema = buildEncodeField(filterOperand(fieldType, opStr), db);
      operands.set(key, operandSchema);
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
