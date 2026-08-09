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
import {
  filterOperandTypeOf,
  type QueryScope,
  type WhereFilterOp,
} from 'firestore-repository/query';
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

/**
 * Built schemas are shared by every caller that names the same schema: building
 * one walks the whole descriptor tree, which dominates the work of a repeated
 * conversion, and the callers that would otherwise hold the memo are built per
 * call by design (`toSdkQuery`, and a pipeline's row decoder). Both maps hold
 * their keys weakly, so entries die with what they were built from.
 *
 * Decoders need only the schema — they read `ref.path` off whatever reference
 * they are handed.
 */
const decoders = new WeakMap<DocumentSchema, z.ZodObject<z.ZodRawShape>>();

/**
 * Encoders also depend on the database: turning a `RefPath` into a
 * `DocumentReference` binds that `Firestore` instance into the schema
 * (`doc(db, ...)`), so two databases cannot share one.
 */
const encoders = new WeakMap<DocumentSchema, WeakMap<Firestore, Encoders>>();

type Encoders = {
  /** The document's write schema. */
  document?: z.ZodObject<z.ZodRawShape>;
  /** Filter operands, keyed by `${operator}:${fieldPath}`. */
  operands: Map<string, ZodAny>;
  /** Cursor values, keyed by field path. */
  cursors: Map<string, ZodAny>;
};

const encodersFor = (schema: DocumentSchema, db: Firestore): Encoders => {
  let perDb = encoders.get(schema);
  if (perDb === undefined) {
    perDb = new WeakMap();
    encoders.set(schema, perDb);
  }
  let forDb = perDb.get(db);
  if (forDb === undefined) {
    forDb = { operands: new Map(), cursors: new Map() };
    perDb.set(db, forDb);
  }
  return forDb;
};

export function buildDecodeSchema(schema: DocumentSchema): z.ZodObject<z.ZodRawShape> {
  let decode = decoders.get(schema);
  if (decode === undefined) {
    decode = z.object(
      Object.fromEntries(
        Object.entries(schema).map(([k, v]) => {
          const s = buildDecodeField(v);
          return [k, v.optional ? s.optional() : s];
        }),
      ),
    );
    decoders.set(schema, decode);
  }
  return decode;
}

function buildDecodeField(fieldType: FieldType): ZodAny {
  switch (fieldType.type) {
    case 'string':
      return z.string();
    case 'bool':
      return z.boolean();
    case 'int64':
      return z.int();
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
  const forDb = encodersFor(schema, db);
  forDb.document ??= z.object(
    Object.fromEntries(
      Object.entries(schema).map(([k, v]) => {
        const s = buildEncodeField(v, db);
        return [k, v.optional ? s.optional() : s];
      }),
    ),
  );
  return forDb.document;
}

function buildEncodeField(fieldType: FieldType, db: Firestore): ZodAny {
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
      return z.instanceof(Uint8Array).transform((b) => FirestoreBytes.fromUint8Array(b));
    case 'geoPoint':
      return z
        .object({ latitude: z.number(), longitude: z.number() })
        .transform((gp) => new FirestoreGeoPoint(gp.latitude, gp.longitude));
    case 'vector':
      return z.array(z.number()).transform((arr) => vector(arr));
    case 'int64':
      return zodUnion([
        z.int(),
        z
          .unknown()
          .refine(isIncrement)
          .refine((v) => Number.isInteger(v.amount), {
            message: 'int64 increment amount must be an integer',
          })
          .transform((v) => firestoreIncrement(v.amount)),
      ]);
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
          .transform((values) => firestoreArrayRemove(...values)),
        z
          .unknown()
          .refine(isArrayUnion)
          .transform((v) => v.values)
          .pipe(elements)
          .transform((values) => firestoreArrayUnion(...values)),
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
 * `filterOperandTypeOf`, the runtime counterpart of the `FilterOperand` type.
 */
export function buildEncodeFilterValue<S extends DocumentSchema>(
  schema: S,
  db: Firestore,
): (fieldPath: DocFieldPath<S>, opStr: WhereFilterOp, value: unknown) => unknown {
  const operandSchemas = encodersFor(schema, db).operands;
  return (fieldPath, opStr, value) => {
    const key = `${opStr}:${fieldPath}`;
    let operandSchema = operandSchemas.get(key);
    if (operandSchema === undefined) {
      const fieldType = fieldTypeOfPath(schema, fieldPath);
      operandSchema = buildEncodeField(filterOperandTypeOf(fieldType, opStr), db);
      operandSchemas.set(key, operandSchema);
    }
    return operandSchema.parse(value);
  };
}

/**
 * Builds the encoder for cursor values, memoizing per field path.
 *
 * A cursor value is a READ-space value of the field the query is ordered by,
 * and reaches Firestore through the write codec for the same reason
 * {@link buildEncodeFilterValue} does: a field's read representation is a
 * subset of its write `input` for every descriptor, and the write conversions
 * (`RefPath` -> `DocumentReference`, `Date` -> `Timestamp`, geopoint / bytes /
 * vector to their SDK classes) are exactly the forms a cursor must compare
 * against. Unlike a filter operand there is no operator to widen the shape —
 * a cursor value is always one value of the field itself.
 *
 * `'__name__'` is the exception, and the reason this takes a {@link QueryScope}
 * — see {@link encodeKeyCursor}.
 */
export function buildEncodeCursorValue<S extends DocumentSchema>(
  schema: S,
  db: Firestore,
): (fieldPath: DocFieldPath<S>, value: unknown, scope: QueryScope) => unknown {
  const valueSchemas = encodersFor(schema, db).cursors;
  return (fieldPath, value, scope) => {
    if (fieldPath === '__name__') {
      return encodeKeyCursor(value, scope);
    }
    let valueSchema = valueSchemas.get(fieldPath);
    if (valueSchema === undefined) {
      const fieldType = fieldTypeOfPath(schema, fieldPath);
      valueSchema = buildEncodeField(fieldType, db);
      valueSchemas.set(fieldPath, valueSchema);
    }
    return valueSchema.parse(value);
  };
}

/**
 * The document key as this SDK wants it in a cursor: a STRING, whose meaning
 * depends on what the query reads (probed, and enforced in `dist/index.node.mjs`).
 *
 * - a collection query wants the bare document id, and rejects anything
 *   containing a slash;
 * - a collection group query wants the full database-relative path, and
 *   rejects a bare id.
 *
 * A `DocumentReference` — which the admin SDK does take — is rejected in both.
 * That divergence is why the library's own operand is the {@link RefPath}
 * segment path, the same as a `__name__` filter takes: it is the only form
 * that can produce all three, since a bare id cannot name its ancestors.
 */
const encodeKeyCursor = (value: unknown, scope: QueryScope): string => {
  const path = refPathSchema('unknown').parse(value);
  switch (scope) {
    case 'collection': {
      const id = path.at(-1);
      if (id === undefined) {
        // `refPathSchema` admits nothing shorter than two segments, so this is
        // unreachable — stated rather than asserted away.
        throw new Error(`reference path [${path.join(', ')}] has no document id`);
      }
      return id;
    }
    case 'collectionGroup':
      return path.join('/');
    default:
      return assertNever(scope);
  }
};

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
