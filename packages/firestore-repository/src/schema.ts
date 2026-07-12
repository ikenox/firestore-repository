import { DocRef } from './repository.js';

/**
 * A definition of a Firestore collection
 */
export type Collection<
  Schema extends DocumentSchema = DocumentSchema,
  Parent extends string[] = string[],
> = { name: string; schema: Schema; parent: Parent };

/** A root collection definition (no parent document) */
export type RootCollection<Schema extends DocumentSchema = DocumentSchema> = Collection<Schema, []>;

/** A subcollection definition (nested under a parent document) */
export type SubCollection<
  Schema extends DocumentSchema = DocumentSchema,
  Parent extends [...string[], string] = [...string[], string],
> = Collection<Schema, Parent>;

/** Creates a root collection definition */
export const rootCollection = <
  Schema extends DocumentSchema & WithoutDottedFieldNames<Schema>,
>(params: {
  name: string;
  schema: Schema;
}): Collection<Schema, []> => {
  assertNoDottedFieldNames(params.schema);
  return { ...params, parent: [] };
};

/** Creates a subcollection definition */
export const subCollection = <
  Schema extends DocumentSchema & WithoutDottedFieldNames<Schema>,
  const Parent extends [...string[], string],
>(params: {
  name: string;
  schema: Schema;
  parent: Parent;
}): SubCollection<Schema, Parent> => {
  assertNoDottedFieldNames(params.schema);
  return params;
};

/** A validation schema for document data */
export type DocumentSchema = MapType['fields'];

/**
 * The vocabulary of the `firestoreType` phantom axis: the type of a field's
 * values **as Firestore itself classifies them**, structurally recursive for
 * containers (an array is the tags of its elements, a map is a per-field tag
 * record).
 *
 * This is a separate axis from the phantom `output`, which is the
 * **TypeScript representation** of the value and therefore conflates types
 * Firestore keeps distinct: a document reference decodes to `string[]` but is
 * not an array of strings, a vector decodes to `number[]` but is not an
 * array of numbers, a geopoint decodes to a `{ latitude, longitude }` object
 * but is not a map. Operand-domain predicates and comparison compatibility
 * (`pipelines/expression.ts`) key on THIS axis so those pairs no longer
 * unify.
 *
 * Deliberate choices (agreed in the pipeline-expressions plan):
 *
 * - No `'absent'` tag: field presence is the orthogonal `optional` marker's
 *   axis, so map tag records are all-required.
 * - `'integer'` and `'double'` are separate tags, but a `number`-valued
 *   descriptor carries the honest union of both (see `Int64Type`).
 * - Literal descriptors map to their base tags — the tag classifies the
 *   Firestore value, not its narrowed TS domain.
 */
export type FirestoreType =
  | 'string'
  | 'integer'
  | 'double'
  | 'boolean'
  | 'null'
  | 'timestamp'
  | 'bytes'
  | 'reference'
  | 'geopoint'
  | 'vector'
  | readonly FirestoreType[]
  | { readonly [field: string]: FirestoreType };

/**
 * The `firestoreType` of a literal value: literals classify as their base
 * Firestore type. A `number` literal is honestly `'integer' | 'double'` —
 * the SDKs choose the wire encoding per value (whole numbers become
 * integers), so neither tag alone would be true.
 */
type LiteralFirestoreType<V extends string | number | boolean | null> = V extends string
  ? 'string'
  : V extends number
    ? 'integer' | 'double'
    : V extends boolean
      ? 'boolean'
      : V extends null
        ? 'null'
        : never;

/**
 * The closed discriminated union of every field descriptor, discriminated by
 * `type`. Being closed (rather than an open `{ type: string }` base) lets
 * `switch (fieldType.type)` narrow each arm to its concrete descriptor and
 * makes `default: assertNever(fieldType)` a real exhaustiveness check —
 * adding a new descriptor surfaces every handling site as a compile error.
 *
 * The recursive members are the widest `Any*` interfaces, not the generic
 * `MapType`/`ArrayType`/`UnionType` aliases — see the comment on those
 * interfaces for why.
 */
export type FieldType =
  | BoolType
  | StringType
  | Int64Type
  | DoubleType
  | TimestampType
  | DocRefType
  | BytesType
  | GeoPointType
  | VectorType
  | NullType
  | AnyMapType
  | AnyArrayType
  | AnyUnionType
  | LiteralType<(string | number | boolean | null)[]>;

export type BoolType = { type: 'bool'; firestoreType: 'boolean'; input: boolean; output: boolean };
export type StringType = { type: 'string'; firestoreType: 'string'; input: string; output: string };
// int64/double both carry the honest `'integer' | 'double'` tag: their value
// type is the JS `number`, and the SDKs pick the wire encoding per value
// (whole numbers become integers), so a `double()` field can hold wire
// integers and neither tag alone would be true. This also keeps the two
// numeric descriptors mutually comparable under overlap-based compatibility.
export type Int64Type = {
  type: 'int64';
  firestoreType: 'integer' | 'double';
  input: number | Increment;
  output: number;
}; // TODO bigint?
export type DoubleType = {
  type: 'double';
  firestoreType: 'integer' | 'double';
  input: number | Increment;
  output: number;
};
export type TimestampType = {
  type: 'timestamp';
  firestoreType: 'timestamp';
  input: Date | ServerTimestamp;
  output: Date;
};
/**
 * A document-reference descriptor. `T` is the referenced collection when the
 * schema knows it (a `docRef(collection)` data field), or the `'unknown'`
 * sentinel when it does not — the reserved `'__name__'` key resolves to
 * `DocRefType<'unknown'>` (probed: `type(__name__)` is `"reference"`, and
 * reference-domain functions accept it while rejecting strings). The sentinel
 * is a visible plain value, like the `Optional` marker, rather than
 * `undefined` ("the collection is unknown", not "there is no collection").
 *
 * The value representation follows the context: a known collection
 * round-trips `DocRef<T>` id tuples, while the context-free flavor reads AND
 * writes relative path strings (`'authors/a1'`) — the one reference
 * representation that needs no collection context, and also the core query
 * API's id-filter contract (`where(eq('__name__', id))`). Pipeline operator
 * compatibility keys on the shared `'reference'` tag, so both flavors
 * compare with each other and with `docRefValue(...)` constants.
 */
export type DocRefType<T extends Collection | 'unknown' = Collection | 'unknown'> = {
  type: 'docRef';
  firestoreType: 'reference';
  collection: T;
  input: T extends Collection ? DocRef<T> : string;
  output: T extends Collection ? DocRef<T> : string;
};
export type BytesType = {
  type: 'bytes';
  firestoreType: 'bytes';
  input: Uint8Array;
  output: Uint8Array;
};
export type GeoPointType = {
  type: 'geoPoint';
  firestoreType: 'geopoint';
  input: GeoPoint;
  output: GeoPoint;
};
export type VectorType = {
  type: 'vector';
  firestoreType: 'vector';
  input: number[];
  output: number[];
};
export type NullType = { type: 'null'; firestoreType: 'null'; input: null; output: null };
/**
 * The widest map/array/union descriptors — the recursive members of the
 * closed {@link FieldType} union. Each concrete `MapType<T>` /
 * `ArrayType<T>` / `UnionType<T>` is a structural subtype of its `Any*`
 * counterpart.
 *
 * Two deliberate choices make the recursion work:
 *
 * - They are `interface`s, not type aliases: their members resolve lazily,
 *   so `FieldType -> AnyMapType -> MapFields -> FieldType` is legal. Spelling
 *   the union with the (eagerly resolved) generic aliases instead is a TS2456
 *   circular reference. Making the generic aliases themselves interfaces does
 *   not work either: TS compares two instantiations of one generic interface
 *   by measured variance, the computed `input`/`output` members measure as
 *   invariant, and e.g. `UnionType<[StringType, NullType]>` would no longer
 *   be accepted where the widest union descriptor is expected.
 * - `input`/`output`/`firestoreType` are `unknown` at this widest level
 *   (for input/output, exactly the width the old open
 *   `{ type: string; input: unknown; output: unknown }` base had). This
 *   terminates the type recursion when resolving the wide union's value
 *   types, and for `firestoreType` it also spares the checker from proving
 *   a generic container's tag against the recursive `FirestoreType` bound —
 *   both the proof failure (TS cannot bound a two-hop generic indexed
 *   access like `T[K]['firestoreType']`) and the conditional-type
 *   workaround for it (which sends constraint computation into unbounded
 *   recursion, crashing tsc) are avoided outright.
 */
export interface AnyMapType {
  type: 'map';
  firestoreType: unknown;
  fields: MapFields;
  input: unknown;
  output: unknown;
}
export interface AnyArrayType {
  type: 'array';
  firestoreType: unknown;
  dynamicPart: FieldType;
  input: unknown;
  output: unknown;
}
export interface AnyUnionType {
  type: 'union';
  firestoreType: unknown;
  elements: FieldType[];
  input: unknown;
  output: unknown;
}
/**
 * An `interface` (with an index signature) rather than a `Record` alias for
 * the same laziness reason as the `Any*` descriptors above.
 */
export interface MapFields {
  [field: string]: FieldType & { optional?: boolean };
}

export type MapType<T extends MapFields = MapFields> = {
  type: 'map';
  // All-required: presence lives on the orthogonal `optional` marker axis.
  firestoreType: { [K in keyof T & string]: T[K]['firestoreType'] };
  fields: T;
  input: ResolveMapValue<T, 'write'>;
  output: ResolveMapValue<T, 'read'>;
};
/**
 * Marks a field descriptor as optional. A plain (string-keyed) property, not a
 * symbol: descriptors are a library-controlled closed structure with no
 * collision risk, and a plain key stays visible to deep-equality assertions
 * (`toStrictEqual`) and survives `structuredClone` — a symbol key does
 * neither. (Contrast with `serverOperation`, which marks *document values*
 * that mix with user data, where a symbol is the right call.)
 */
export type Optional = { optional: true };
export type ArrayType<DynamicPart extends FieldType = FieldType> = {
  type: 'array';
  firestoreType: readonly DynamicPart['firestoreType'][];
  dynamicPart: DynamicPart;
  input: ResolveArrayValue<DynamicPart, 'write'>;
  output: ResolveArrayValue<DynamicPart, 'read'>;
};
export type UnionType<T extends FieldType[] = FieldType[]> = {
  type: 'union';
  // Distributes: the tags of a union are the union of its members' tags.
  firestoreType: T[number]['firestoreType'];
  elements: T;
  input: ResolveUnionValue<T, 'write'>;
  output: ResolveUnionValue<T, 'read'>;
};
export type LiteralType<T extends (string | number | boolean | null)[]> = {
  type: 'const';
  firestoreType: LiteralFirestoreType<T[number]>;
  values: T;
  input: T[number];
  output: T[number];
};

export type FieldValue<T extends FieldType, Mode extends 'read' | 'write'> =
  | (Mode extends 'read' ? T['output'] : never)
  | (Mode extends 'write' ? T['input'] : never);

export type ResolveMapValue<
  T extends MapFields,
  Mode extends 'read' | 'write',
> = MakeSomeFieldsOptional<
  { [K in keyof T]: FieldValue<T[K], Mode> },
  { [K in keyof T]: T[K]['optional'] extends true ? K : never }[keyof T]
>;

export type ResolveArrayValue<T extends FieldType, Mode extends 'read' | 'write'> =
  | FieldValue<T, Mode>[]
  | (Mode extends 'write'
      ? ArrayRemove<FieldValue<T, 'read'>> | ArrayUnion<FieldValue<T, 'read'>>
      : never);

export type ResolveUnionValue<T extends FieldType[], Mode extends 'read' | 'write'> = {
  [K in keyof T]: T[K] extends FieldType ? FieldValue<T[K], Mode> : never;
}[number & keyof T];

export type GeoPoint = { latitude: number; longitude: number };
export type ArrayRemove<T> = { [serverOperation]: 'arrayRemove'; values: T[] }; // TODO
export type ArrayUnion<T> = { [serverOperation]: 'arrayUnion'; values: T[] }; // TODO
export type ServerTimestamp = { [serverOperation]: 'serverTimestamp' };
export type Increment = { [serverOperation]: 'increment'; amount: number };

type MakeSomeFieldsOptional<T extends Record<string, unknown>, OptFields extends keyof T> = Merge<
  Pick<{ [K in keyof T]?: T[K] }, OptFields> & Omit<T, OptFields>
>;
type Merge<T> = { [K in keyof T]: T[K] };

export const serverOperation: unique symbol = Symbol();

/**
 * Rejects schema field names containing `.` (the offending field's type
 * becomes `never`, so the schema literal fails to type-check). Dots are the
 * path separator of {@link MapFieldPath} / {@link FieldTypeOfPath}, so a
 * dotted field name would be unaddressable (or ambiguous with a nested
 * path). Enforced by every factory that accepts a field map (`map`,
 * `rootCollection`, `subCollection`).
 */
type WithoutDottedFieldNames<T> = {
  [K in keyof T]: K extends `${string}.${string}` ? never : T[K];
};

/** Runtime counterpart of {@link WithoutDottedFieldNames}. */
const assertNoDottedFieldNames = (fields: DocumentSchema): void => {
  for (const field of Object.keys(fields)) {
    if (field.includes('.')) {
      throw new Error(`schema field name "${field}" must not contain "."`);
    }
  }
};

/**
 * Constructs a schema type value without specifying the phantom
 * `input`/`output`/`firestoreType` fields.
 * Those fields exist only at the type level to carry value type information (valibot-style),
 * so they must not appear in runtime objects. The `as T` cast attaches the phantom types
 * without requiring them in the object literal.
 */
const buildType = <T extends FieldType>(v: Omit<T, 'input' | 'output' | 'firestoreType'>): T =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- phantom type cast: input/output/firestoreType fields exist only at type level
  v as T;

export const bool = (): BoolType => buildType({ type: 'bool' });
export const string = (): StringType => buildType({ type: 'string' });
export const int64 = (): Int64Type => buildType({ type: 'int64' });
export const double = (): DoubleType => buildType({ type: 'double' });
export const timestamp = (): TimestampType => buildType({ type: 'timestamp' });
export function docRef<T extends Collection>(collection: T): DocRefType<T>;
/**
 * The context-free flavor: a reference to no one particular collection —
 * usable as a schema data field (round-tripping relative path strings), and
 * the descriptor the reserved `'__name__'` resolves to.
 */
export function docRef(): DocRefType<'unknown'>;
export function docRef(collection?: Collection): FieldType {
  return buildType<DocRefType>({ type: 'docRef', collection: collection ?? 'unknown' });
}
export const bytes = (): BytesType => buildType({ type: 'bytes' });
export const geoPoint = (): GeoPointType => buildType({ type: 'geoPoint' });
export const vector = (): VectorType => buildType({ type: 'vector' });
export const map = <T extends MapFields & WithoutDottedFieldNames<T>>(fields: T): MapType<T> => {
  assertNoDottedFieldNames(fields);
  return buildType({ type: 'map', fields });
};
export const array = <T extends FieldType>(elementType: T): ArrayType<T> =>
  buildType({ type: 'array', dynamicPart: elementType });
export const union = <T extends FieldType[]>(...elements: T): UnionType<T> =>
  buildType({ type: 'union', elements });
export const nullType = (): NullType => buildType({ type: 'null' });

export const literal = <const T extends (string | number | boolean | null)[]>(
  ...values: T
): LiteralType<T> => buildType({ type: 'const', values });

export const nullable = <T extends FieldType>(t: T): UnionType<[T, NullType]> =>
  union(t, nullType());

export const optional = <T extends FieldType>(type: T): T & Optional =>
  buildType({ ...type, optional: true });

/**
 * A type-safe path to anything addressable on a **document**: either one of its
 * data fields ({@link MapFieldPath}) or the reserved document key `'__name__'`
 * (the document's id / path).
 *
 * This is the document-level path — the superset that includes `'__name__'`.
 * Use it wherever the key is legitimately addressable alongside data fields,
 * e.g. `where` / `sort` / ordering may reference `'__name__'`. For contexts that
 * may only touch data fields — notably `select` projections, which must not be
 * able to re-project the key — use {@link MapFieldPath} instead (it omits
 * `'__name__'`). See `pipelines/selection.ts`.
 */
export type DocFieldPath<T extends DocumentSchema> = MapFieldPath<T> | '__name__';

/**
 * A type-safe path into a schema's **data** fields: a top-level field name, or a
 * dotted path descending through nested `MapType` fields (e.g. `'profile.age'`).
 *
 * This is the "data only" base. It **excludes** the reserved document key
 * `'__name__'`, which is a document-level concept, not a field of the data map;
 * {@link DocFieldPath} adds it back. Keeping the two separate lets `select`
 * accept `MapFieldPath` so the key is not projectable (projecting `'__name__'`
 * un-aliased would silently preserve read-identity — see
 * `pipelines/selection.ts` and `docs/pipeline-query-identity-research.md`).
 *
 * (Recurses through nested `MapType` fields; short-circuits to `string` for the
 * unconstrained `DocumentSchema` to avoid infinite type instantiation.)
 */
export type MapFieldPath<T extends MapType['fields']> = MapType['fields'] extends T
  ? string // avoid circular deep type instantiation
  : {
      [K in keyof T & string]:
        | K
        | (T[K] extends MapType ? `${K}.${MapFieldPath<T[K]['fields']>}` : never);
    }[keyof T & string];

/**
 * Resolves field value type at the specified path.
 * (Field names containing dots would collide with the path separator, but the
 * schema factories reject them — see {@link WithoutDottedFieldNames}.)
 */
export type FieldTypeOfPath<T extends DocumentSchema, U extends DocFieldPath<T>> = U extends keyof T
  ? // root field
    T[U]
  : U extends `${infer P}.${infer R}`
    ? P extends keyof T
      ? T[P] extends MapType
        ? // expand nested fields P.*
          FieldTypeOfPath<T[P]['fields'], R>
        : never
      : never
    : U extends '__name__'
      ? DocRefType<'unknown'>
      : never;

/**
 * Runtime counterpart of {@link FieldTypeOfPath}: resolves the `FieldType`
 * descriptor stored in `schema` at `path` (dotted for nested maps; `'__name__'`
 * resolves to a context-free `DocRefType<'unknown'>`, mirroring the type).
 */
export const fieldTypeOfPath = <T extends DocumentSchema, U extends DocFieldPath<T>>(
  schema: T,
  path: U,
): FieldTypeOfPath<T, U> => {
  const dot = path.indexOf('.');
  let resolved: FieldType;
  if (path === '__name__') {
    resolved = docRef();
  } else if (dot < 0) {
    resolved = requireField(schema, path);
  } else {
    // A dotted path's head is a map (enforced by `DocFieldPath`).
    const head = requireField(schema, path.slice(0, dot));
    if (!isMapType(head)) {
      throw new Error(`field "${path.slice(0, dot)}" is not a map`);
    }
    resolved = fieldTypeOfPath(head.fields, path.slice(dot + 1));
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the runtime walk mirrors `FieldTypeOfPath`, but the compiler cannot connect a runtime schema value to the type-level result
  return resolved as FieldTypeOfPath<T, U>;
};

const requireField = (schema: DocumentSchema, key: string): FieldType => {
  const type = schema[key];
  if (type === undefined) {
    throw new Error(`schema has no field "${key}"`);
  }
  return type;
};

/**
 * Resolves field value type at the specified path
 */
export type FieldValueOfPath<T extends DocumentSchema, U extends DocFieldPath<T>> = FieldValue<
  FieldTypeOfPath<T, U>,
  'read'
>;

// Extract the part of P after `K.` for paths nested under K.
// Distributing via `infer M` is required: a non-distributive form like
// `Extract<...> extends \`${K}.${infer R}\` ? R : never` causes `infer R`
// to fall back to `string` when the Extract is `never`.
export type TailPath<K extends string, P extends string> =
  Extract<P, `${K}.${string}`> extends infer M ? (M extends `${K}.${infer R}` ? R : never) : never;

/**
 * Projects a schema down to the given dot-paths, preserving the nested MapType structure.
 * `PickPaths<T, "profile.age">` yields `{ profile: MapType<{ age: ... }> }`.
 */
export type PickPaths<T extends DocumentSchema, P extends string> = MapType['fields'] extends T
  ? T
  : {
      [K in keyof T & string as K extends P
        ? K
        : [TailPath<K, P>] extends [never]
          ? never
          : K]: K extends P
        ? T[K]
        : T[K] extends MapType<infer F>
          ? T[K] extends Optional
            ? MapType<PickPaths<F, TailPath<K, P>>> & Optional
            : MapType<PickPaths<F, TailPath<K, P>>>
          : T[K];
    };

/**
 * Removes the given dot-paths from a schema, preserving the nested MapType structure.
 * `OmitPaths<T, "profile.gender">` yields the schema with `profile.gender` removed.
 * A path that exactly matches a top-level key drops that whole subtree. When a
 * nested removal empties a MapType, that now-empty map is dropped too (which can
 * cascade up to its parents).
 */
export type OmitPaths<T extends DocumentSchema, P extends string> = MapType['fields'] extends T
  ? T
  : {
      [K in keyof T & string as K extends P
        ? never
        : T[K] extends MapType<infer F>
          ? [TailPath<K, P>] extends [never]
            ? K
            : keyof OmitPaths<F, TailPath<K, P>> extends never
              ? never // nested removal emptied this map -> drop the key
              : K
          : K]: T[K] extends MapType<infer F>
        ? [TailPath<K, P>] extends [never]
          ? T[K]
          : T[K] extends Optional
            ? MapType<OmitPaths<F, TailPath<K, P>>> & Optional
            : MapType<OmitPaths<F, TailPath<K, P>>>
        : T[K];
    };

/**
 * Runtime counterpart of {@link OmitPaths} (the type's `P` union of paths is
 * the `paths` array), decomposed the same way — `tailPath` mirrors
 * {@link TailPath}, and the branch structure follows the mapped type
 * branch-for-branch: an exact key match drops the subtree, a nested removal
 * recurses into the map (preserving an `Optional` marker), and a map emptied
 * by the removal is dropped too. The `buildOmitPathsSchema`-style oracle tests
 * in `schema.test.ts` assert value and type against one oracle.
 */
export const omitPaths = <T extends DocumentSchema, const P extends readonly string[]>(
  schema: T,
  paths: P,
): OmitPaths<T, P[number]> => {
  const result: Record<string, FieldType> = {};
  for (const [key, fieldType] of Object.entries(schema)) {
    if (paths.includes(key)) {
      continue; // exact match drops the whole subtree
    }
    const tail = tailPath(key, paths);
    // Read the marker before `isMapType` narrows the descriptor to `AnyMapType`
    // (narrowing drops the `optional?` part of the `MapFields` intersection).
    const markedOptional = fieldType.optional === true;
    if (!isMapType(fieldType) || tail.length === 0) {
      result[key] = fieldType;
      continue;
    }
    const nested = omitPaths(fieldType.fields, tail);
    if (Object.keys(nested).length === 0) {
      continue; // nested removal emptied this map -> drop the key
    }
    const nestedMap = map(nested);
    result[key] = markedOptional ? optional(nestedMap) : nestedMap;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the runtime walk mirrors the type-level `OmitPaths`, but the compiler cannot connect a runtime schema value to the type-level result
  return result as OmitPaths<T, P[number]>;
};

/** Runtime counterpart of {@link TailPath}: the sub-paths of `paths` nested under `key`. */
const tailPath = (key: string, paths: readonly string[]): string[] =>
  paths.filter((p) => p.startsWith(`${key}.`)).map((p) => p.slice(key.length + 1));

/**
 * Narrows a `FieldType` descriptor to the widest map descriptor. The
 * `t is AnyMapType` predicate is inferred (and therefore checked) by the
 * compiler — pinned in `schema.test.ts`.
 */
export const isMapType = (t: FieldType) => t.type === 'map';
