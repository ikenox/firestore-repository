import type * as firestore from '@google-cloud/firestore';
import {
  DocumentReference as FirestoreDocumentReference,
  FieldValue,
  GeoPoint as FirestoreGeoPoint,
  Timestamp as FirestoreTimestamp,
  VectorValue as FirestoreVectorValue,
} from '@google-cloud/firestore';
import { filterOperandTypeOf, type WhereFilterOp } from 'firestore-repository/query';
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

/** A `Map` or `WeakMap` — whatever {@link memoize} is asked to store into. */
type Store<K, V> = { get: (key: K) => V | undefined; set: (key: K, value: V) => unknown };

/** Returns the stored value for `key`, building and storing it on a miss. */
const memoize = <K, V>(store: Store<K, V>, key: K, build: () => V): V => {
  const stored = store.get(key);
  if (stored !== undefined) {
    return stored;
  }
  const built = build();
  store.set(key, built);
  return built;
};

type Encoders = {
  /** The data schema for a write. */
  data?: z.ZodObject<z.ZodRawShape>;
  /** Filter operands, keyed by `${operator}:${fieldPath}`. */
  operands: Map<string, ZodAny>;
  /** Whole-field values, keyed by field path. */
  fields: Map<string, ZodAny>;
};

/**
 * Every built schema this module memoizes, and the only place one is stored.
 * Callers pass how to build theirs and never touch a map, so what is cached
 * under which key is answered here rather than at four call sites.
 *
 * Building a schema walks the whole descriptor tree, which dominates the work
 * of a repeated conversion, and the callers that would otherwise hold the memo
 * are built per call by design (`toSdkQuery`, and a pipeline's row decoder).
 * Keys are held weakly throughout, so entries die with the schema or database
 * they were built from.
 *
 * Decoders need only the schema — they read `ref.path` off whatever reference
 * they are handed. Encoders also depend on the database, because turning a
 * `RefPath` into a `DocumentReference` binds that `Firestore` instance into
 * the schema (`db.doc(...)`), so two databases cannot share one. Those are
 * keyed by database first, then schema, because that is the order the two
 * differ in: an application holds one database and reaches many schemas
 * through it, and a pipeline mints a fresh schema per stage chain. Nesting the
 * other way would allocate an inner map per schema to hold a single entry.
 */
const cache = (() => {
  const decoders = new WeakMap<DocumentSchema, z.ZodObject<z.ZodRawShape>>();
  const encoders = new WeakMap<firestore.Firestore, WeakMap<DocumentSchema, Encoders>>();

  const encodersFor = (schema: DocumentSchema, db: firestore.Firestore): Encoders =>
    memoize(
      memoize(encoders, db, () => new WeakMap<DocumentSchema, Encoders>()),
      schema,
      () => ({ operands: new Map(), fields: new Map() }),
    );

  return {
    /** The decoder for a document's (or a pipeline row's) data. */
    decoder: (schema: DocumentSchema, build: () => z.ZodObject<z.ZodRawShape>) =>
      memoize(decoders, schema, build),

    /** The encoder for a document's data on `db`. */
    data: (
      schema: DocumentSchema,
      db: firestore.Firestore,
      build: () => z.ZodObject<z.ZodRawShape>,
    ) => {
      const encoders = encodersFor(schema, db);
      return (encoders.data ??= build());
    },

    /**
     * The encoder for one filter operand.
     *
     * An operand whose type is the field's own — every comparison operator —
     * shares the field entry rather than taking one of its own, since the two
     * would build the same schema. The operators that reshape the operand
     * (`in` wraps it in a list, `array-contains` unwraps to the element) get
     * their own entry, keyed by operator and path.
     */
    operand: (
      schema: DocumentSchema,
      db: firestore.Firestore,
      fieldPath: string,
      opStr: WhereFilterOp,
      fieldType: FieldType,
      operandType: FieldType,
      build: () => ZodAny,
    ) =>
      operandType === fieldType
        ? memoize(encodersFor(schema, db).fields, fieldPath, build)
        : memoize(encodersFor(schema, db).operands, `${opStr}:${fieldPath}`, build),

    /** The encoder for one field's value, keyed by its path. */
    field: (
      schema: DocumentSchema,
      db: firestore.Firestore,
      fieldPath: string,
      build: () => ZodAny,
    ) => memoize(encodersFor(schema, db).fields, fieldPath, build),
  };
})();

export const dataDecoder = (schema: DocumentSchema): z.ZodObject<z.ZodRawShape> =>
  cache.decoder(schema, () =>
    z.object(
      Object.fromEntries(
        Object.entries(schema).map(([k, v]) => {
          const s = buildDecodeField(v);
          return [k, v.optional ? s.optional() : s];
        }),
      ),
    ),
  );

const buildDecodeField = (fieldType: FieldType): ZodAny => {
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
};

export const dataEncoder = (
  schema: DocumentSchema,
  db: firestore.Firestore,
): z.ZodObject<z.ZodRawShape> =>
  cache.data(schema, db, () =>
    z.object(
      Object.fromEntries(
        Object.entries(schema).map(([k, v]) => {
          const s = buildEncodeField(v, db);
          return [k, v.optional ? s.optional() : s];
        }),
      ),
    ),
  );

const buildEncodeField = (fieldType: FieldType, db: firestore.Firestore): ZodAny => {
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
      return zodUnion([
        z.int(),
        z
          .unknown()
          .refine(isIncrement)
          .refine((v) => Number.isInteger(v.amount), {
            message: 'int64 increment amount must be an integer',
          })
          .transform((v) => FieldValue.increment(v.amount)),
      ]);
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
};

/**
 * Builds the encoder for filter-condition operands, memoizing the operand
 * schema per (field path, operator) like `dataEncoder` builds the
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
export const filterOperandEncoder = <S extends DocumentSchema>(
  schema: S,
  db: firestore.Firestore,
): ((fieldPath: DocFieldPath<S>, opStr: WhereFilterOp, value: unknown) => unknown) => {
  return (fieldPath, opStr, value) => {
    const fieldType = fieldTypeOfPath(schema, fieldPath);
    const operandType = filterOperandTypeOf(fieldType, opStr);
    return cache
      .operand(schema, db, fieldPath, opStr, fieldType, operandType, () =>
        buildEncodeField(operandType, db),
      )
      .parse(value);
  };
};

/**
 * Builds the encoder for cursor values, memoizing per field path.
 *
 * A cursor value is a READ-space value of the field the query is ordered by,
 * and reaches Firestore through the write codec for the same reason
 * {@link filterOperandEncoder} does: a field's read representation is a
 * subset of its write `input` for every descriptor, and the write conversions
 * (`RefPath` -> `DocumentReference`, `Date` -> `Timestamp`, geopoint / bytes /
 * vector to their SDK classes) are exactly the forms a cursor must compare
 * against. Unlike a filter operand there is no operator to widen the shape —
 * a cursor value is always one value of the field itself.
 *
 * `'__name__'` needs nothing special here: the admin SDK takes a
 * `DocumentReference` for the document key exactly as it does for a reference
 * field, which is what the descriptor's encoder already produces. The client
 * SDK is the one that differs — see its own codec.
 */
export const cursorValueEncoder = <S extends DocumentSchema>(
  schema: S,
  db: firestore.Firestore,
): ((fieldPath: DocFieldPath<S>, value: unknown) => unknown) => {
  return (fieldPath, value) =>
    cache
      .field(schema, db, fieldPath, () => buildEncodeField(fieldTypeOfPath(schema, fieldPath), db))
      .parse(value);
};

/**
 * A zod schema for a `RefPath` segment path. A known collection's tuple shape
 * is exact — literal collection names at the even positions — while the
 * context-free flavor accepts any even-length segment path.
 */
const refPathSchema = (collection: Collection | 'unknown'): z.ZodType<string[]> => {
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
};

const zodUnion = (schemas: ZodAny[]): ZodAny => {
  if (schemas.length === 0) {
    throw new Error('union must have at least one element');
  }
  if (schemas.length === 1) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return schemas[0] as ZodAny;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return z.union(schemas as [ZodAny, ZodAny, ...ZodAny[]]);
};
