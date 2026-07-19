import { refPath } from '../path.js';
import type { DocRef } from '../repository.js';
import {
  type AnyUnionType,
  array,
  type Collection,
  type ArrayType,
  assertNoDottedFieldNames,
  bool,
  type BoolType,
  bytes,
  type BytesType,
  docRef,
  type DocRefType,
  double,
  type DoubleType,
  type FieldType,
  type FirestoreType,
  geoPoint,
  type GeoPointType,
  int64,
  type Int64Type,
  literal,
  type LiteralType,
  map,
  type MapType,
  nullable,
  nullType,
  type NullType,
  type Optional,
  string,
  type StringType,
  timestamp,
  type TimestampType,
  union,
  type UnionType,
  vector,
  type VectorType,
} from '../schema.js';
import { assertNever } from '../util.js';

// NOTE: this module was trimmed to the AST core plus `field` / `constant` /
// `equal` (the only expression factories currently used). The full set of ~85
// SDK expression factories (arithmetic / string / array / map / timestamp /
// vector / ...) was removed pending a rework — see docs/plan/pipeline-query.md.

/**
 * An expression AST node. A discriminated union **of classes** (see
 * {@link ExpressionBase}): keep this union — not the base class — as the
 * public type, so `switch (expr.kind)` narrowing and `assertNever`
 * exhaustiveness keep working (a base-class-typed value would not narrow).
 */
// Value nodes (GeoPointValue / VectorValue / DocRefValue) are NOT members:
// they are VALUES, and the one way any value becomes an expression is
// `constant()` — `constant(geoPointValue(1, 3))`, exactly like `constant(5)`
// (and like the official SDK's `constant(new GeoPoint(...))`). Every member
// therefore carries `type: T` natively, which is what scopes operand domains
// and feeds operator type inference.
export type Expression<T extends FieldType = FieldType> = Field<T> | Constant<T> | FunctionCall<T>;

/**
 * An expression bound to an output name — the aliased form of a `select` /
 * `addFields` selection (the counterpart of the SDK's `expr.as(alias)`
 * selectable). Built with {@link ExpressionBase.as}.
 */
export type ExpressionWithAlias<
  T extends FieldType = FieldType,
  Alias extends string = string,
> = WithAlias<Expression<T>, Alias>;

/** The `{ expression, alias }` pair, generic over the expression node type. */
type WithAlias<E, Alias extends string> = { expression: E; alias: Alias };

/**
 * Base class of all expression nodes, carrying the SDK-style fluent methods
 * (`field('rank').as('r')`, `equal(...).as('flag')`). The polymorphic `this`
 * in the return type resolves to the concrete node class at the call site, so
 * the result satisfies {@link ExpressionWithAlias} without any assertion.
 */
export abstract class ExpressionBase {
  /**
   * Binds this expression to an output name, forming a `select` / `addFields`
   * selection.
   *
   * The reserved `'__name__'` alias is deliberately NOT modelled here — no
   * type guard, no runtime guard: the backend rejects overwriting it
   * (`INVALID_ARGUMENT: field name '__name__' is reserved and can not be
   * overwritten` — verified live), loudly and at the source of truth, so a
   * client-side check would only duplicate that validation. (Contrast with
   * bare `'__name__'` selections, which the backend *accepts* while
   * re-attaching identity — those ARE type-banned in `Selection`, because
   * they would silently succeed against `select`'s `Id = undefined` model.
   * The rule: ban what would silently succeed against the type model; leave
   * what fails loudly to the backend. See
   * `docs/pipeline-query-identity-research.md`.)
   */
  as<Alias extends string>(alias: Alias): WithAlias<this, Alias> {
    return { expression: this, alias };
  }
}

export class Field<
  T extends FieldType = FieldType,
  Path extends string = string,
> extends ExpressionBase {
  readonly kind = 'field';
  constructor(
    readonly type: T,
    readonly path: Path,
  ) {
    super();
  }
}

/** Builds a field-reference expression node carrying its resolved `type`. */
export const field = <T extends FieldType, Path extends string>(
  type: T,
  path: Path,
): Field<T, Path> => new Field(type, path);

export class Constant<T extends FieldType = FieldType> extends ExpressionBase {
  readonly kind = 'constant';
  /** Always derived from `value` — a constant whose descriptor lies about its value is unconstructible. */
  readonly type: T;
  readonly value: ConstantValue;

  // Private: `of` is the only construction point, so `T` always matches the
  // actual value (a `new Constant<Wrong>(v)` escape hatch does not exist).
  private constructor(type: T, value: ConstantValue) {
    super();
    this.type = type;
    this.value = value;
  }

  static of<const V extends ConstantValue>(value: V): Constant<ConstantTypeOf<V>> {
    return new Constant(constantTypeOf(value), value);
  }
}

/**
 * A geopoint VALUE (not an expression — lift it with
 * `constant(geoPointValue(...))`). A dedicated constructor because a geopoint
 * has no JS representation of its own: a plain `{ latitude, longitude }`
 * object is always a **map** constant.
 */
export class GeoPointValue {
  readonly type: GeoPointType = geoPoint();
  constructor(
    readonly latitude: number,
    readonly longitude: number,
  ) {}
}

/**
 * A vector VALUE (not an expression — lift it with
 * `constant(vectorValue(...))`). A dedicated constructor because a `number[]`
 * is always an **array** constant.
 */
export class VectorValue {
  readonly type: VectorType = vector();
  readonly values: readonly number[];
  constructor(values: readonly number[]) {
    this.values = [...values];
  }
}

/**
 * A document-reference VALUE (not an expression — lift it with
 * `constant(docRefValue(...))`). A dedicated constructor for the same
 * classification rule as {@link GeoPointValue} / {@link VectorValue}: a
 * reference's plain-JS representation (`RefPath`, a segment path) is a
 * string array — always an **array** constant — so the reference
 * interpretation must be explicit. This is the comparand that makes
 * reference comparisons meaningful: probed, the pipeline backend never
 * matches `__name__` against ANY string form (id / relative path / full
 * resource path — all `false`), only against a reference value. Build the
 * segment path from a repository-side id with `refPath(collection, id)`
 * (`path.js`).
 */
export class DocRefValue<T extends Collection | 'unknown' = 'unknown'> {
  /** Always coherent with `path` — the sealed constructor is the only construction point (the `Constant` precedent). */
  readonly type: DocRefType<T>;
  readonly path: readonly string[];

  private constructor(type: DocRefType<T>, path: readonly string[]) {
    this.type = type;
    this.path = [...path];
  }

  /** Context-free form: an untyped segment path — `DocRefType<'unknown'>`. */
  static of(this: void, path: readonly string[]): DocRefValue;
  /**
   * Collection + address form: `DocRefValue.of(authors, ['a1'])`, typed
   * `DocRefType<Authors>`. Receiving the collection DEFINITION is what makes
   * the known-collection typing possible (a segment tuple alone cannot
   * recover the collection type); the address is normalized to the same
   * segment-path payload, so the wire form is identical to the
   * context-free flavor.
   */
  static of<T extends Collection>(this: void, collection: T, id: DocRef<T>): DocRefValue<T>;
  static of(
    this: void,
    first: readonly string[] | Collection,
    id?: [...string[], string],
  ): DocRefValue<Collection | 'unknown'> {
    if (isSegments(first)) {
      return new DocRefValue(docRef(), first);
    }
    if (id === undefined) {
      throw new Error('the collection form requires an id tuple');
    }
    return new DocRefValue(docRef(first), refPath(first, id));
  }
}

/** Builds a document-reference value — sugar for {@link DocRefValue}.of, like `constant` for `Constant.of`. */
export const docRefValue = DocRefValue.of;

// `Array.isArray`'s built-in `arg is any[]` does not narrow READONLY array
// unions (the `isConstantArray` precedent) — the annotation deliberately
// overrides it.
const isSegments = (v: readonly string[] | Collection): v is readonly string[] => Array.isArray(v);

/**
 * The value domain `constant()` accepts — everything with an unambiguous
 * plain-JS representation: scalars, arrays and plain-object maps,
 * recursively. Firestore types WITHOUT their own JS representation get
 * explicit constructors instead — a plain object is always a **map** constant
 * (use {@link geoPointValue} for geopoints), a `number[]` is always an
 * **array** constant (use {@link vectorValue} for vectors), and a `string[]`
 * segment path likewise (use {@link docRefValue} for document references).
 */
export type ConstantValue = ConstantScalar | ConstantLeafNode | ConstantArray | ConstantMap;
export type ConstantScalar = string | number | boolean | null | Date | Uint8Array;
/**
 * Value nodes usable as composite leaves: Firestore values may hold
 * geopoints, vectors, and document references at any depth, and since those
 * have no plain-JS representation of their own, their explicit nodes stand
 * in — `constant({ spot: geoPointValue(1, 3) })`.
 */
export type ConstantLeafNode = GeoPointValue | VectorValue | DocRefValue<Collection | 'unknown'>;
/**
 * Non-empty (an empty literal has no element to infer a descriptor from) and
 * non-nested: directly nested arrays (`constant([1, [2, 3]])`) are excluded
 * from the element type because Firestore's data model itself forbids an
 * array value inside another array — the official SDK does not support them
 * either. (An array inside a *map* inside an array is fine.)
 */
export type ConstantArray = readonly [ConstantElement, ...ConstantElement[]];
type ConstantElement = ConstantScalar | ConstantLeafNode | ConstantMap;
export type ConstantMap = { readonly [key: string]: ConstantValue };

/**
 * The descriptor a constant value infers to. All JS numbers map to
 * `DoubleType` — the SDK decides integer/double wire encoding itself, and the
 * descriptor's client-side roles (operand domains, projected-schema decode)
 * treat the two identically.
 */
export type ConstantTypeOf<V extends ConstantValue> = ConstantValue extends V
  ? FieldType // wide/unresolved input: break the recursion (same trick as MapFieldPath)
  : V extends null
    ? NullType
    : V extends Date
      ? TimestampType
      : V extends Uint8Array
        ? BytesType
        : V extends DocRefValue<infer C>
          ? DocRefType<C>
          : V extends GeoPointValue
            ? GeoPointType
            : V extends VectorValue
              ? VectorType
              : V extends string
                ? StringType
                : V extends number
                  ? DoubleType
                  : V extends boolean
                    ? BoolType
                    : V extends ConstantArray
                      ? ArrayConstantTypeOf<V>
                      : V extends ConstantMap
                        ? MapType<{ -readonly [K in keyof V & string]: ConstantTypeOf<V[K]> }>
                        : never;

/**
 * The element descriptor is derived by walking the TUPLE (not the union of
 * the element types): tuple order is stable, so the runtime can mirror the
 * exact same first-occurrence dedup. A single distinct element type stays
 * bare; several become a `UnionType` in tuple order — matching the runtime's
 * `union(...deduped)`.
 */
type ArrayConstantTypeOf<V extends ConstantArray> =
  DedupDescriptors<{ readonly [K in keyof V]: ConstantTypeOf<V[K]> }> extends infer D
    ? D extends readonly [infer Only extends FieldType]
      ? ArrayType<Only>
      : D extends readonly FieldType[]
        ? ArrayType<UnionType<[...D]>>
        : never
    : never;

/** First-occurrence dedup over a tuple of descriptors (mutual-`extends` equality). */
type DedupDescriptors<
  T extends readonly FieldType[],
  Acc extends readonly FieldType[] = [],
> = T extends readonly [infer H extends FieldType, ...infer R extends readonly FieldType[]]
  ? IncludesDescriptor<Acc, H> extends true
    ? DedupDescriptors<R, Acc>
    : DedupDescriptors<R, [...Acc, H]>
  : Acc;

type IncludesDescriptor<T extends readonly FieldType[], X extends FieldType> = T extends readonly [
  infer H extends FieldType,
  ...infer R extends readonly FieldType[],
]
  ? DescriptorEquals<H, X> extends true
    ? true
    : IncludesDescriptor<R, X>
  : false;

type DescriptorEquals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Runtime counterpart of {@link ConstantTypeOf} (same branch order). The
 * overload signature carries the type-level result; the implementation is
 * checked loosely against it, which is where the runtime-to-type bridge lives
 * (the compiler cannot correlate the `typeof` branches with the conditional
 * type — the oracle tests in `expression.test.ts` are the safety net).
 */
function constantTypeOf<V extends ConstantValue>(value: V): ConstantTypeOf<V>;
function constantTypeOf(value: ConstantValue): FieldType {
  if (value === null) {
    return nullType();
  }
  if (value instanceof Date) {
    return timestamp();
  }
  if (value instanceof Uint8Array) {
    return bytes();
  }
  if (
    value instanceof GeoPointValue ||
    value instanceof VectorValue ||
    value instanceof DocRefValue
  ) {
    return value.type;
  }
  if (isConstantArray(value)) {
    if (value.length === 0) {
      // Runtime twin of ConstantArray's non-empty tuple constraint.
      throw new Error('constant arrays must not be empty (no element to infer a type from)');
    }
    // Mirrors ArrayConstantTypeOf: first-occurrence dedup in tuple order, a
    // single distinct descriptor stays bare, several become a union.
    const elements = value.map((element) => constantTypeOf(element));
    const deduped = elements.filter(
      (d, i) => elements.findIndex((e) => descriptorEquals(e, d)) === i,
    );
    const [only] = deduped;
    return only !== undefined && deduped.length === 1 ? array(only) : array(union(...deduped));
  }
  switch (typeof value) {
    case 'string':
      return string();
    case 'number':
      return double();
    case 'boolean':
      return bool();
    case 'object':
      // The only remaining ConstantValue: a plain-object map.
      return map(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, constantTypeOf(v)])));
    case 'bigint':
    case 'symbol':
    case 'undefined':
    case 'function':
      // Impossible for a ConstantValue — `value` is narrowed to `never` here.
      return assertNever(value);
    default:
      return assertNever(value);
  }
}

/** `Array.isArray` does not narrow `readonly` array unions — a dedicated guard does. */
const isConstantArray = (value: ConstantValue): value is ConstantArray => Array.isArray(value);

/** Structural descriptor equality (key-order insensitive; descriptors are plain data). */
const descriptorEquals = (a: unknown, b: unknown): boolean => {
  if (a === b) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  const entriesA = Object.entries(a);
  const bRecord = new Map(Object.entries(b));
  return (
    entriesA.length === bRecord.size &&
    entriesA.every(([k, v]) => bRecord.has(k) && descriptorEquals(v, bRecord.get(k)))
  );
};

export const constant = <const V extends ConstantValue>(value: V): Constant<ConstantTypeOf<V>> =>
  Constant.of(value);

/**
 * Builds a geopoint constant from explicit coordinates. A plain
 * `{ latitude, longitude }` object is deliberately not a {@link ConstantValue}:
 * structurally it is just an object, so it would be ambiguous with map
 * constants (and tolerant of excess fields). Named `geoPointValue` to avoid
 * colliding with the `geoPoint()` descriptor factory in `schema.ts`, matching
 * the `arrayValue` / `mapValue` constructor naming.
 */
export const geoPointValue = (latitude: number, longitude: number): GeoPointValue =>
  new GeoPointValue(latitude, longitude);

/** Builds a vector value from explicit components — see {@link VectorValue}. */
export const vectorValue = (values: readonly number[]): VectorValue => new VectorValue(values);

/**
 * A function-call expression node. ONE class for every function: per-function
 * structure lives in the {@link FunctionPayload} union (discriminated by
 * `name`), not in per-shape classes — a class exists where a node needs an
 * `instanceof` brand (the value nodes, `Constant`'s sealed constructor), and
 * a payload needs no brand, so it stays plain data. The node carries the
 * function-independent parts (the `kind` discriminant, the return descriptor
 * `type`, the `.as()` base); everything per-function — which operands exist
 * and what they are named — is the payload's business, so executors translate
 * calls with one exhaustive `switch (call.name)` over typed payload fields
 * (no untyped `args` array, no runtime arity guards). Per-function operand
 * compatibility and return-type inference live in the factory signatures.
 */
export class FunctionCall<T extends FieldType = FieldType> extends ExpressionBase {
  readonly kind = 'functionCall';
  constructor(
    readonly type: T,
    readonly call: FunctionPayload,
  ) {
    super();
  }
}

/** The name vocabulary of every supported function — {@link FunctionPayload}'s discriminant. */
export type FunctionName = FunctionPayload['name'];

/**
 * The per-function payload union, discriminated by `name`: each member states
 * the exact named operands its function takes, so an executor destructures a
 * narrowed payload without arity checks. Operand fields are `Expression`s;
 * backend-mandated LITERAL arguments (`isType`'s type name, the timestamp
 * units/granularities/parts/timezones, the map keys) are PLAIN fields of
 * their literal type instead — the backend requires literal constants there
 * (probed), so nothing is lost by not modelling them as expressions, and the
 * executors serialize them as wire constants. A dual-arity function is one
 * payload with an optional trailing field (`round.decimalPlaces?`,
 * `substring.length?`, ...), never two members.
 */
// Grouped by function CATEGORY (matching the factory sections below), not by
// anything historical.
export type FunctionPayload =
  // logical
  | { name: 'and'; conditions: readonly [Expression, Expression, ...Expression[]] }
  | { name: 'or'; conditions: readonly [Expression, Expression, ...Expression[]] }
  | { name: 'xor'; conditions: readonly [Expression, Expression, ...Expression[]] }
  | { name: 'not'; condition: Expression }
  // comparison
  | { name: 'equal'; left: Expression; right: Expression }
  | { name: 'notEqual'; left: Expression; right: Expression }
  | { name: 'lessThan'; left: Expression; right: Expression }
  | { name: 'lessThanOrEqual'; left: Expression; right: Expression }
  | { name: 'greaterThan'; left: Expression; right: Expression }
  | { name: 'greaterThanOrEqual'; left: Expression; right: Expression }
  | { name: 'equalAny'; value: Expression; options: Expression }
  | { name: 'notEqualAny'; value: Expression; options: Expression }
  // conditional & extremes
  | { name: 'conditional'; condition: Expression; thenExpr: Expression; elseExpr: Expression }
  | { name: 'logicalMaximum'; operands: readonly [Expression, Expression, ...Expression[]] }
  | { name: 'logicalMinimum'; operands: readonly [Expression, Expression, ...Expression[]] }
  // arithmetic
  | { name: 'rand' }
  | { name: 'add'; left: Expression; right: Expression }
  | { name: 'subtract'; left: Expression; right: Expression }
  | { name: 'multiply'; left: Expression; right: Expression }
  | { name: 'divide'; left: Expression; right: Expression }
  | { name: 'mod'; left: Expression; right: Expression }
  | { name: 'pow'; base: Expression; exponent: Expression }
  | { name: 'abs'; value: Expression }
  | { name: 'ceil'; value: Expression }
  | { name: 'floor'; value: Expression }
  | { name: 'round'; value: Expression; decimalPlaces?: Expression }
  | { name: 'trunc'; value: Expression; decimalPlaces?: Expression }
  | { name: 'sqrt'; value: Expression }
  | { name: 'exp'; value: Expression }
  | { name: 'ln'; value: Expression }
  | { name: 'log10'; value: Expression }
  // string
  | { name: 'charLength'; value: Expression }
  | { name: 'byteLength'; value: Expression }
  | { name: 'toLower'; value: Expression }
  | { name: 'toUpper'; value: Expression }
  | { name: 'stringReverse'; value: Expression }
  | { name: 'trim'; value: Expression; characters?: Expression }
  | { name: 'ltrim'; value: Expression; characters?: Expression }
  | { name: 'rtrim'; value: Expression; characters?: Expression }
  | { name: 'startsWith'; value: Expression; prefix: Expression }
  | { name: 'endsWith'; value: Expression; suffix: Expression }
  | { name: 'stringContains'; value: Expression; substring: Expression }
  | { name: 'stringConcat'; operands: readonly [Expression, Expression, ...Expression[]] }
  | { name: 'stringIndexOf'; value: Expression; substring: Expression }
  | { name: 'stringRepeat'; value: Expression; count: Expression }
  | { name: 'stringReplaceAll'; value: Expression; find: Expression; replacement: Expression }
  | { name: 'stringReplaceOne'; value: Expression; find: Expression; replacement: Expression }
  | { name: 'substring'; value: Expression; position: Expression; length?: Expression }
  | { name: 'like'; value: Expression; pattern: Expression }
  // regex
  | { name: 'regexContains'; value: Expression; pattern: Expression }
  | { name: 'regexMatch'; value: Expression; pattern: Expression }
  | { name: 'regexFind'; value: Expression; pattern: Expression }
  | { name: 'regexFindAll'; value: Expression; pattern: Expression }
  // reference
  | { name: 'documentId'; reference: Expression }
  | { name: 'collectionId'; reference: Expression }
  // type
  | { name: 'type'; value: Expression }
  | { name: 'isType'; value: Expression; typeName: FirestoreTypeName }
  // existence & error
  | { name: 'exists'; target: Expression }
  | { name: 'isAbsent'; target: Expression }
  | { name: 'isError'; value: Expression }
  | { name: 'ifError'; tryExpr: Expression; catchExpr: Expression }
  | { name: 'ifAbsent'; value: Expression; fallback: Expression }
  | { name: 'ifNull'; value: Expression; fallback: Expression }
  // array
  | { name: 'arrayValue'; elements: readonly [Expression, ...Expression[]] }
  | { name: 'arrayLength'; value: Expression }
  | { name: 'arrayReverse'; value: Expression }
  | { name: 'arrayGet'; value: Expression; index: Expression }
  | { name: 'arrayContains'; value: Expression; element: Expression }
  | { name: 'arrayContainsAll'; value: Expression; options: Expression }
  | { name: 'arrayContainsAny'; value: Expression; options: Expression }
  | { name: 'arrayConcat'; operands: readonly [Expression, Expression, ...Expression[]] }
  // map
  | { name: 'mapValue'; fields: Readonly<Record<string, Expression>> }
  | { name: 'mapGet'; value: Expression; key: string }
  | { name: 'mapKeys'; value: Expression }
  | { name: 'mapValues'; value: Expression }
  | { name: 'mapEntries'; value: Expression }
  | { name: 'mapSet'; value: Expression; key: string; entry: Expression }
  | { name: 'mapRemove'; value: Expression; key: string }
  | { name: 'mapMerge'; operands: readonly [Expression, Expression, ...Expression[]] }
  // timestamp
  | { name: 'currentTimestamp' }
  | { name: 'timestampToUnixSeconds'; value: Expression }
  | { name: 'timestampToUnixMillis'; value: Expression }
  | { name: 'timestampToUnixMicros'; value: Expression }
  | { name: 'unixSecondsToTimestamp'; value: Expression }
  | { name: 'unixMillisToTimestamp'; value: Expression }
  | { name: 'unixMicrosToTimestamp'; value: Expression }
  | { name: 'timestampAdd'; value: Expression; unit: TimeUnit; amount: Expression }
  | { name: 'timestampSubtract'; value: Expression; unit: TimeUnit; amount: Expression }
  | { name: 'timestampDiff'; end: Expression; start: Expression; unit: TimeUnit }
  | {
      name: 'timestampTruncate';
      value: Expression;
      granularity: TimeGranularity;
      timezone?: string;
    }
  | { name: 'timestampExtract'; value: Expression; part: TimePart; timezone?: string }
  // vector
  | { name: 'cosineDistance'; left: Expression; right: Expression }
  | { name: 'dotProduct'; left: Expression; right: Expression }
  | { name: 'euclideanDistance'; left: Expression; right: Expression }
  | { name: 'vectorLength'; vector: Expression };

/**
 * The value-domain predicate: descriptors whose `firestoreType` tags fit the
 * given tag set — so for `Valued<'boolean'>`, `bool()`, boolean literals,
 * `nullable(bool())`, and `& Optional` variants all qualify structurally.
 *
 * Predicates key on the `firestoreType` axis (not the TS-representation
 * `output`), and `null` is special-cased HERE, once, so individual domains
 * never mention it: probed backend semantics make `null` a well-behaved
 * operand everywhere (`null` and absent operands flow through functions as
 * `null`, and a non-`true` condition just drops the row), so a nullable
 * descriptor is inside every domain. See
 * docs/plan/pipeline-query-expressions.md.
 */
export type Valued<Tag extends FirestoreType> = FieldType & { firestoreType: Tag | 'null' };

/**
 * Overlap-based comparison compatibility: a pair is comparable iff the
 * operands' `firestoreType` tag sets intersect — computed MEMBER-WISE at
 * every depth ({@link TagSetsComparable}), so a shared element tag is enough
 * for two heterogeneous arrays to compare. Evaluates to `unknown` (no-op
 * intersection) on overlap and `never` on disjoint domains, rejecting the
 * call.
 *
 * The backend's comparisons are total (probed: `equal(null, 'x')` is `false`,
 * never an error), so this rule is a lint against always-false comparisons —
 * and the correct boundary for that lint is ZERO overlap, mirroring TS's own
 * `===` rule (whose nested-union handling this matches). A union operand with
 * a shared member overlaps a narrower one
 * (`equal(field(union(string(), double())), constant('x'))` is legal).
 */
type Comparable<L extends FieldType, R extends FieldType> =
  TagSetsComparable<L['firestoreType'], R['firestoreType']> extends true ? unknown : never;

/**
 * Whether two tag SETS (unions of {@link FirestoreType} members) are
 * comparable. This is the one rule, applied uniformly at every depth (the
 * top-level operands, array elements, map fields):
 *
 * - `'null'` is special-cased, consistent with the domain predicates: it is
 *   stripped before the overlap test, so sets sharing ONLY `'null'` are not
 *   comparable (`nullable(string())` vs `nullable(timestamp())` is true only
 *   in the both-null corner — almost surely a bug) — EXCEPT when one side is
 *   PURE null (`constant(null)` / a `nullType()` field): that is an is-null
 *   check, legal against any nullable set and rejected against a never-null
 *   one (always false).
 * - A wide input (the unconstrained `FirestoreType`, or the `unknown` the
 *   `Any*` descriptors carry) accepts leniently — it also breaks the
 *   otherwise-infinite recursion through the self-referential vocabulary.
 */
type TagSetsComparable<A, B> = FirestoreType extends A
  ? true // wide/unknown input: lenient (and a recursion breaker)
  : FirestoreType extends B
    ? true
    : true extends TagSetsOverlap<Exclude<A, 'null'>, Exclude<B, 'null'>>
      ? true
      : [Exclude<A, 'null'>] extends [never]
        ? 'null' extends B & 'null' // pure-null left: an is-null check on the right
          ? true
          : false
        : [Exclude<B, 'null'>] extends [never]
          ? 'null' extends A & 'null' // pure-null right: an is-null check on the left
            ? true
            : false
          : false;

/**
 * Distributes both null-stripped sets into member pairs; the result is the
 * union of the pairwise verdicts, so `true extends ...` asks "does SOME pair
 * overlap".
 */
type TagSetsOverlap<A, B> = A extends unknown
  ? B extends unknown
    ? TagPairOverlaps<A, B>
    : never
  : never;

/**
 * Whether two single tags overlap: scalars by equality, arrays by their
 * element SETS being comparable (recursion, null rule included), maps by
 * width-directional key inclusion plus per-shared-key comparability —
 * matching how TS's own `===` treats nested structures.
 */
type TagPairOverlaps<A, B> = A extends readonly FirestoreType[]
  ? B extends readonly FirestoreType[]
    ? TagSetsComparable<A[number], B[number]>
    : false
  : B extends readonly FirestoreType[]
    ? false
    : A extends { readonly [field: string]: FirestoreType }
      ? B extends { readonly [field: string]: FirestoreType }
        ? MapTagsOverlap<A, B>
        : false
      : B extends { readonly [field: string]: FirestoreType }
        ? false
        : A extends B // both scalar tags: literal equality
          ? true
          : false;

/**
 * One key set must include the other (maps of genuinely different shapes
 * never hold equal values), and every shared key must be comparable.
 */
type MapTagsOverlap<
  A extends { readonly [field: string]: FirestoreType },
  B extends { readonly [field: string]: FirestoreType },
> = [keyof B] extends [keyof A]
  ? SharedKeysComparable<A, B, keyof B>
  : [keyof A] extends [keyof B]
    ? SharedKeysComparable<A, B, keyof A>
    : false;

type SharedKeysComparable<
  A extends { readonly [field: string]: FirestoreType },
  B extends { readonly [field: string]: FirestoreType },
  K extends keyof A & keyof B,
> = false extends (K extends unknown ? TagSetsComparable<A[K], B[K]> : never) ? false : true;

// ---- Prototype: direct literal operands (branch `direct-literal-operands`) ----
// An operand position accepts a raw value alongside an expression; the factory
// lifts the raw via `Constant.of` internally — exactly the official SDK's
// `equal(field('x'), 5)`. ONE lifting rule, applied uniformly, NOT per-function
// overloads. Prototyped on five factories (`equal` / `add` / `startsWith` /
// `and` / `timestampAdd`); the rest still take `Expression`s.

/** Anything usable in an operand position: an expression, or a raw value liftable via `constant()`. */
type OperandInput = Expression | ConstantValue;

/**
 * The descriptor an operand input carries (an expression) or would lift to (a
 * raw value). Distributes over a union input (used by the variadic factories).
 */
type TypeOfOperand<V extends OperandInput> = V extends Expression
  ? V['type']
  : V extends ConstantValue
    ? ConstantTypeOf<V>
    : never;

/**
 * Runtime twin of the lifting rule: pass an expression through, wrap a raw
 * value with `Constant.of`. The value nodes (`GeoPointValue` / `VectorValue` /
 * `DocRefValue`) are NOT `ExpressionBase` — they are `ConstantValue` leaves,
 * so they take the lifting branch, matching `constant(geoPointValue(...))`.
 *
 * The overload signature preserves the operand's PRECISE descriptor
 * (`Expression<TypeOfOperand<V>>`, not a widened `Expression`): a factory that
 * lifts first then reads `[l, r][number]['type']` for `propagateNull` /
 * `NumericResult` must keep the precise type or its return descriptor collapses
 * to the wide/nullable branch. The loose impl is the runtime-to-type bridge
 * (same shape as `propagateNull`).
 */
function toOperand<V extends OperandInput>(v: V): Expression<TypeOfOperand<V>>;
function toOperand(v: OperandInput): Expression {
  return v instanceof ExpressionBase ? v : Constant.of(v);
}

/**
 * The lifted form of an operand-input tuple: each raw value replaced by the
 * expression it lifts to, preserving arity and order — the type-level twin of
 * {@link liftOperands}, fed to the variadic return-descriptor operators
 * (`LogicalExtreme`, `ConcatElementUnion`, `MergeFields`, ...).
 */
type LiftedOperands<Ops extends readonly OperandInput[]> = {
  [K in keyof Ops]: Expression<TypeOfOperand<Ops[K]>>;
};

/** Tuple-preserving {@link toOperand} for the variadic factories (mirrors the input tuple's arity). */
function liftOperands<Ops extends readonly OperandInput[]>(ops: Ops): LiftedOperands<Ops>;
function liftOperands(ops: readonly OperandInput[]): Expression[] {
  return ops.map(toOperand);
}

/** Record-preserving {@link toOperand} for {@link mapValue}: lift each field value to an expression. */
function liftFields<F extends Readonly<Record<string, OperandInput>>>(
  fields: F,
): { [K in keyof F & string]: Expression<TypeOfOperand<F[K]>> };
function liftFields(fields: Readonly<Record<string, OperandInput>>): Record<string, Expression> {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, toOperand(v)]));
}

// Operand-INPUT domains: the expression domain widened with the raw values
// that lift INTO it. `null` is a member of every domain (its `NullType` is
// null-tolerated by `Valued`, so a nullable expression already qualifies) —
// keeping `equal(x, null)` / `add(x, null)` uniform with `constant(null)`.
type NumericOperandInput = NumericOperand | number | null;
type StringOperandInput = StringOperand | string | null;
type BooleanOperandInput = Expression<Valued<'boolean'>> | boolean | null;
type TimestampOperandInput = TimestampOperand | Date | null;
// The composite / value-node domains: a raw array lifts to an array constant,
// a raw plain object to a map constant, and the value nodes (`docRefValue` /
// `vectorValue`) are `ConstantValue` leaves that lift like any other raw.
type ArrayOperandInput = ArrayOperand | ConstantArray | null;
type MapOperandInput = MapOperand | ConstantMap | null;
type ReferenceOperandInput = ReferenceOperand | DocRefValue<Collection | 'unknown'> | null;
type VectorOperandInput = VectorOperand | VectorValue | null;

export const equal = <const L extends OperandInput, const R extends OperandInput>(
  left: L,
  right: R & Comparable<TypeOfOperand<L>, TypeOfOperand<R>>,
): FunctionCall<BoolType> =>
  new FunctionCall(bool(), { name: 'equal', left: toOperand(left), right: toOperand(right) });

export const notEqual = <const L extends OperandInput, const R extends OperandInput>(
  left: L,
  right: R & Comparable<TypeOfOperand<L>, TypeOfOperand<R>>,
): FunctionCall<BoolType> =>
  new FunctionCall(bool(), { name: 'notEqual', left: toOperand(left), right: toOperand(right) });

export const lessThan = <const L extends OperandInput, const R extends OperandInput>(
  left: L,
  right: R & Comparable<TypeOfOperand<L>, TypeOfOperand<R>>,
): FunctionCall<BoolType> =>
  new FunctionCall(bool(), { name: 'lessThan', left: toOperand(left), right: toOperand(right) });

export const lessThanOrEqual = <const L extends OperandInput, const R extends OperandInput>(
  left: L,
  right: R & Comparable<TypeOfOperand<L>, TypeOfOperand<R>>,
): FunctionCall<BoolType> =>
  new FunctionCall(bool(), {
    name: 'lessThanOrEqual',
    left: toOperand(left),
    right: toOperand(right),
  });

export const greaterThan = <const L extends OperandInput, const R extends OperandInput>(
  left: L,
  right: R & Comparable<TypeOfOperand<L>, TypeOfOperand<R>>,
): FunctionCall<BoolType> =>
  new FunctionCall(bool(), { name: 'greaterThan', left: toOperand(left), right: toOperand(right) });

export const greaterThanOrEqual = <const L extends OperandInput, const R extends OperandInput>(
  left: L,
  right: R & Comparable<TypeOfOperand<L>, TypeOfOperand<R>>,
): FunctionCall<BoolType> =>
  new FunctionCall(bool(), {
    name: 'greaterThanOrEqual',
    left: toOperand(left),
    right: toOperand(right),
  });

/** The element domain of an array descriptor (wide/lenient for imprecise inputs, like `TagSetsComparable`). */
type ElementsOf<T extends FieldType> = T extends {
  type: 'array';
  dynamicPart: infer E extends FieldType;
}
  ? E
  : FieldType;

/**
 * Whether `value` equals ANY element of the `options` array. Total like the
 * comparisons (probed): an absent value or a no-match is `false` — a null
 * ELEMENT is matched as a value (`equalAny(null-field, constant([null]))` is
 * `true`), never propagated. `options` is one array-typed operand — an array
 * field, `constant([1, 5, 9])`, or a **raw array** `[1, 5, 9]` that lifts to
 * an array constant (resolving the plan's `equalAny` sugar question: the raw
 * array is just the ordinary lifting rule, and the element-comparability
 * guard runs against the lifted `ArrayType`'s element). Its elements must be
 * comparable with `value`.
 */
export const equalAny = <const L extends OperandInput, const R extends ArrayOperandInput>(
  value: L,
  options: R & Comparable<TypeOfOperand<L>, ElementsOf<TypeOfOperand<R>>>,
): FunctionCall<BoolType> =>
  new FunctionCall(bool(), {
    name: 'equalAny',
    value: toOperand(value),
    options: toOperand(options),
  });

/** Whether `value` differs from EVERY element of the `options` array — see {@link equalAny}. */
export const notEqualAny = <const L extends OperandInput, const R extends ArrayOperandInput>(
  value: L,
  options: R & Comparable<TypeOfOperand<L>, ElementsOf<TypeOfOperand<R>>>,
): FunctionCall<BoolType> =>
  new FunctionCall(bool(), {
    name: 'notEqualAny',
    value: toOperand(value),
    options: toOperand(options),
  });

/**
 * Null propagation for a function's RETURN descriptor: `T` when no operand
 * can be null, `nullable(T)` when one can. An operand "can be null" when its
 * tags include `'null'` or it is `& Optional` — an absent operand flows
 * through functions as `null` (probed), so optionality implies a possibly-null
 * result even though presence stays off the tag axis.
 *
 * The logical operators need this (probed — Kleene three-valued logic:
 * `and(true, null)` is `null` while `and(false, null)` is `false`, `or` and
 * `not` mirror it), and so do most value functions. The comparison
 * operators do NOT: they are total (never null).
 */
type PropagateNull<Operands extends FieldType, T extends FieldType> = [
  Extract<Operands['firestoreType'], 'null'> | Extract<Operands, Optional>,
] extends [never]
  ? T
  : UnionType<[T, NullType]>;

/**
 * Runtime counterpart of {@link PropagateNull} (the overload signature
 * carries the type-level result; the loose implementation check is the
 * runtime-to-type bridge, mirrored branch-for-branch by `mayBeNull` /
 * the type's `Extract` arms).
 *
 * Takes the operand EXPRESSIONS and reads their descriptors via the
 * type-level `Ops['type']`: a value-level `.type` access on a generic operand
 * resolves eagerly through its constraint (which includes `'null'`), which
 * would collapse the conditional to the nullable branch for every call.
 */
function propagateNull<Ops extends readonly Expression[], T extends FieldType>(
  operands: Ops,
  type: T,
): PropagateNull<Ops[number]['type'], T>;
function propagateNull(operands: readonly Expression[], type: FieldType): FieldType {
  return operands.some((operand) => mayBeNull(operand.type)) ? nullable(type) : type;
}

/**
 * Whether a value of the descriptor can be `null` (or absent — which functions
 * receive as `null`). Mirrors {@link PropagateNull}'s condition: the `'null'`
 * tag distributes through unions and null literals but deliberately not into
 * array elements or map fields, and the `Optional` marker counts.
 */
const mayBeNull = (t: FieldType & { optional?: boolean }): boolean => {
  if (t.optional === true) {
    return true;
  }
  switch (t.type) {
    case 'null':
      return true;
    case 'union':
      return t.elements.some(mayBeNull);
    case 'const':
      return t.values.includes(null);
    case 'bool':
    case 'string':
    case 'int64':
    case 'double':
    case 'timestamp':
    case 'docRef':
    case 'bytes':
    case 'geoPoint':
    case 'vector':
    case 'map':
    case 'array':
      return false;
    default:
      return assertNever(t);
  }
};

/**
 * Absence-only variant of {@link PropagateNull}, for the TYPE-OBSERVING
 * functions (`type` / `isType`): probed, a `null` VALUE is observed as the
 * `'null'` type (not propagated), while an ABSENT operand still nulls the
 * result — so only the `Optional` marker triggers the nullable widening.
 */
type PropagateAbsence<Operands extends FieldType, T extends FieldType> = [
  Extract<Operands, Optional>,
] extends [never]
  ? T
  : UnionType<[T, NullType]>;

/** Runtime counterpart of {@link PropagateAbsence} (same bridge shape as `propagateNull`). */
function propagateAbsence<Ops extends readonly Expression[], T extends FieldType>(
  operands: Ops,
  type: T,
): PropagateAbsence<Ops[number]['type'], T>;
function propagateAbsence(operands: readonly Expression[], type: FieldType): FieldType {
  return operands.some((operand) => mayBeAbsent(operand.type)) ? nullable(type) : type;
}

/** Runtime twin of `Extract<Operands, Optional>`: the marker only. */
const mayBeAbsent = (t: FieldType & { optional?: boolean }): boolean => t.optional === true;

/**
 * An operand descriptor as it appears in a RESULT descriptor: presence
 * (the `Optional` marker) is a property of the operand's document slot, not
 * of the values a function can produce, so it never carries over. Absence
 * that flows through a function is expressed by the `PropagateAbsence`
 * family instead.
 */
type WithoutOptional<T extends FieldType> = T extends Optional ? Omit<T, 'optional'> : T;

/** Runtime counterpart of {@link WithoutOptional}. */
const withoutOptional = (t: FieldType & { optional?: boolean }): FieldType => {
  if (t.optional !== true) {
    return t;
  }
  const { optional: _optional, ...rest } = t;
  return rest;
};

/**
 * The type of "one of these two expressions' values" — the return descriptor
 * of the branching functions (`conditional`, the `if*` fallbacks): the single
 * descriptor when both sides agree, their union otherwise. A `never` side
 * (e.g. a fully null-stripped `StripNull`) collapses to the other. Operands'
 * `Optional` markers are dropped (see {@link WithoutOptional}).
 */
type EitherType<A extends FieldType, B extends FieldType> = [A] extends [never]
  ? WithoutOptional<B>
  : DescriptorEquals<WithoutOptional<A>, WithoutOptional<B>> extends true
    ? WithoutOptional<A>
    : UnionType<[WithoutOptional<A>, WithoutOptional<B>]>;

/** Runtime counterpart of {@link EitherType} (same bridge shape as `propagateNull`). */
function eitherType<A extends Expression, B extends Expression>(
  a: A,
  b: B,
): EitherType<A['type'], B['type']>;
function eitherType(a: Expression, b: Expression): FieldType {
  return fallbackType(withoutOptional(a.type), b.type);
}

/** `EitherType` over already-resolved descriptors, with the `never` side as `undefined`. */
const fallbackType = (a: FieldType | undefined, b: FieldType): FieldType => {
  const bare = withoutOptional(b);
  if (a === undefined) {
    return bare;
  }
  return descriptorEquals(a, bare) ? a : union(a, bare);
};

/**
 * The descriptor with its null-ness removed — what remains of a value that
 * was JUST OBSERVED to be non-null (`ifNull`'s pass-through side,
 * `logicalMaximum`/`logicalMinimum`'s operands, whose null/absent inputs are
 * ignored). `never` when nothing remains (a pure-null descriptor). Strips
 * the `NullType` member from unions, `null` from literal value sets; wide
 * inputs pass through (a recursion breaker, like `TagSetsComparable`).
 */
type StripNull<T extends FieldType> = FieldType extends T
  ? T
  : WithoutOptional<T> extends infer U extends FieldType
    ? StripNullBare<U>
    : never;

type StripNullBare<T extends FieldType> = T extends NullType
  ? never
  : T extends { type: 'union'; elements: infer E extends readonly FieldType[] }
    ? FieldType[] extends E
      ? T
      : RebuildUnion<NonNullElements<E>>
    : T extends {
          type: 'const';
          values: infer V extends readonly (string | number | boolean | null)[];
        }
      ? NonNullLiteralValues<V> extends infer W extends readonly (string | number | boolean)[]
        ? W extends readonly []
          ? never
          : LiteralType<[...W]>
        : never
      : T;

type NonNullElements<E extends readonly FieldType[]> = E extends readonly [
  infer H extends FieldType,
  ...infer R extends readonly FieldType[],
]
  ? H extends NullType
    ? NonNullElements<R>
    : [H, ...NonNullElements<R>]
  : [];

type NonNullLiteralValues<V extends readonly (string | number | boolean | null)[]> =
  V extends readonly [
    infer H extends string | number | boolean | null,
    ...infer R extends readonly (string | number | boolean | null)[],
  ]
    ? H extends null
      ? NonNullLiteralValues<R>
      : [H, ...NonNullLiteralValues<R>]
    : [];

type RebuildUnion<E extends readonly FieldType[]> = E extends readonly [infer One extends FieldType]
  ? One
  : E extends readonly []
    ? never
    : E extends [FieldType, FieldType, ...FieldType[]]
      ? UnionType<E>
      : never;

/** Runtime counterpart of {@link StripNull} (`never` is `undefined`). */
const stripNull = (raw: FieldType): FieldType | undefined => {
  const t = withoutOptional(raw);
  switch (t.type) {
    case 'null':
      return undefined;
    case 'union': {
      const [first, ...rest] = t.elements.filter((e) => e.type !== 'null');
      if (first === undefined) {
        return undefined;
      }
      return rest.length === 0 ? first : union(first, ...rest);
    }
    case 'const': {
      const [first, ...rest] = t.values.filter((v) => v !== null);
      return first === undefined ? undefined : literal(first, ...rest);
    }
    case 'bool':
    case 'string':
    case 'int64':
    case 'double':
    case 'timestamp':
    case 'docRef':
    case 'bytes':
    case 'geoPoint':
    case 'vector':
    case 'map':
    case 'array':
      return t;
    default:
      return assertNever(t);
  }
};

/**
 * The return descriptor of `logicalMaximum` / `logicalMinimum`: the deduped
 * union of the operands' null-stripped types (null/absent operands are
 * IGNORED by the backend's value-type ordering — probed), plus `NullType`
 * only when EVERY operand may be null or absent (the all-ignored case
 * returns null — probed).
 */
type LogicalExtreme<Ops extends readonly Expression[]> = RebuildUnion<
  DedupDescriptors<[...StrippedTypes<Ops>, ...(AllMayBeNull<Ops> extends true ? [NullType] : [])]>
>;

type StrippedTypes<Ops extends readonly Expression[]> = Ops extends readonly [
  infer H extends Expression,
  ...infer R extends readonly Expression[],
]
  ? [StripNull<H['type']>] extends [never]
    ? StrippedTypes<R>
    : [StripNull<H['type']>, ...StrippedTypes<R>]
  : [];

type AllMayBeNull<Ops extends readonly Expression[]> = Ops extends readonly [
  infer H extends Expression,
  ...infer R extends readonly Expression[],
]
  ? MayBeNullOrAbsent<H['type']> extends true
    ? AllMayBeNull<R>
    : false
  : true;

type MayBeNullOrAbsent<T extends FieldType> = [
  Extract<T['firestoreType'], 'null'> | Extract<T, Optional>,
] extends [never]
  ? false
  : true;

/** Runtime counterpart of {@link LogicalExtreme} (same bridge shape as `propagateNull`). */
function logicalExtremeType<Ops extends readonly Expression[]>(operands: Ops): LogicalExtreme<Ops>;
function logicalExtremeType(operands: readonly Expression[]): FieldType {
  const stripped = operands
    .map((operand) => stripNull(operand.type))
    .filter((t): t is FieldType => t !== undefined)
    .filter((t, i, all) => all.findIndex((o) => descriptorEquals(o, t)) === i);
  if (operands.every((operand) => mayBeNull(operand.type) || mayBeAbsent(operand.type))) {
    stripped.push(nullType());
  }
  const [first, ...rest] = stripped;
  if (first === undefined) {
    return nullType();
  }
  return rest.length === 0 ? first : union(first, ...rest);
}

/** Logical conjunction of two or more boolean expressions (Kleene: null operands propagate). */
export const and = <
  const Ops extends readonly [BooleanOperandInput, BooleanOperandInput, ...BooleanOperandInput[]],
>(
  ...conditions: Ops
): FunctionCall<PropagateNull<TypeOfOperand<Ops[number]>, BoolType>> => {
  const lifted = liftOperands(conditions);
  return new FunctionCall(propagateNull(lifted, bool()), { name: 'and', conditions: lifted });
};

/** Logical disjunction of two or more boolean expressions (Kleene: null operands propagate). */
export const or = <
  const Ops extends readonly [BooleanOperandInput, BooleanOperandInput, ...BooleanOperandInput[]],
>(
  ...conditions: Ops
): FunctionCall<PropagateNull<TypeOfOperand<Ops[number]>, BoolType>> => {
  const lifted = liftOperands(conditions);
  return new FunctionCall(propagateNull(lifted, bool()), { name: 'or', conditions: lifted });
};

/** Logical negation of a boolean expression (Kleene: a null operand propagates). */
export const not = <const C extends BooleanOperandInput>(
  condition: C,
): FunctionCall<PropagateNull<TypeOfOperand<C>, BoolType>> => {
  const c = toOperand(condition);
  return new FunctionCall(propagateNull([c], bool()), { name: 'not', condition: c });
};

/** Logical parity — true iff an odd number of operands is true (Kleene: null operands propagate). */
export const xor = <
  const Ops extends readonly [BooleanOperandInput, BooleanOperandInput, ...BooleanOperandInput[]],
>(
  ...conditions: Ops
): FunctionCall<PropagateNull<TypeOfOperand<Ops[number]>, BoolType>> => {
  const lifted = liftOperands(conditions);
  return new FunctionCall(propagateNull(lifted, bool()), { name: 'xor', conditions: lifted });
};

/**
 * Branches on a boolean condition: the `then` value when it is `true`, the
 * `else` value otherwise — INCLUDING a null, absent, or false condition
 * (probed: not Kleene; anything non-true selects `else`). An ERROR condition
 * propagates.
 */
export const conditional = <
  const C extends BooleanOperandInput,
  const T extends OperandInput,
  const E extends OperandInput,
>(
  condition: C,
  thenExpr: T,
  elseExpr: E,
): FunctionCall<EitherType<TypeOfOperand<T>, TypeOfOperand<E>>> => {
  const c = toOperand(condition);
  const t = toOperand(thenExpr);
  const e = toOperand(elseExpr);
  return new FunctionCall(eitherType(t, e), {
    name: 'conditional',
    condition: c,
    thenExpr: t,
    elseExpr: e,
  });
};

/**
 * The largest operand under the backend's cross-type value ordering. Null
 * and absent operands are IGNORED (probed — unlike `sort`'s null-first
 * ordering); when every operand is null/absent the result is null.
 */
export const logicalMaximum = <
  const Ops extends readonly [OperandInput, OperandInput, ...OperandInput[]],
>(
  ...operands: Ops
): FunctionCall<LogicalExtreme<LiftedOperands<Ops>>> => {
  const lifted = liftOperands(operands);
  return new FunctionCall(logicalExtremeType(lifted), { name: 'logicalMaximum', operands: lifted });
};

/** The smallest operand — see {@link logicalMaximum}. */
export const logicalMinimum = <
  const Ops extends readonly [OperandInput, OperandInput, ...OperandInput[]],
>(
  ...operands: Ops
): FunctionCall<LogicalExtreme<LiftedOperands<Ops>>> => {
  const lifted = liftOperands(operands);
  return new FunctionCall(logicalExtremeType(lifted), { name: 'logicalMinimum', operands: lifted });
};

// Operand shorthands for the factories below. These name EXPRESSION domains
// (the null special-casing itself lives once, in `Valued`).
type NumericOperand = Expression<Valued<'integer' | 'double'>>;
type StringOperand = Expression<Valued<'string'>>;

// ---- arithmetic ----
// Numeric result kinds mirror the backend (probed): the type-preserving
// operators (add / subtract / multiply / mod — and divide, which TRUNCATES
// on integers — plus the rounding family abs / ceil / floor / round / trunc)
// keep int64 when every numeric operand is declared int64 and are doubles
// otherwise; pow / sqrt / exp / ln / log10 are ALWAYS doubles. The
// declaration is what refines (`int64()` vs `double()` fields carry the same
// honest 'integer' | 'double' tag — a whole JS number wire-encodes as an
// integer either way). Error edges (divide by zero, ln(0), sqrt of a
// negative) produce backend ERROR values, not null — observable and
// recoverable only through the error channel (isError / ifError).

/**
 * The result kind of the type-preserving arithmetic: `Int64Type` when every
 * numeric operand is a declared int64 (null-stripped), `DoubleType`
 * otherwise.
 */
type NumericResult<Operands extends FieldType> = [StripNull<Operands>] extends [Int64Type]
  ? Int64Type
  : DoubleType;

/** Runtime counterpart of {@link NumericResult} (same bridge shape as `propagateNull`). */
function numericResultType<Ops extends readonly Expression[]>(
  operands: Ops,
): NumericResult<Ops[number]['type']>;
function numericResultType(operands: readonly Expression[]): FieldType {
  return operands.every((operand) => stripNull(operand.type)?.type === 'int64')
    ? int64()
    : double();
}

/** A uniformly distributed random double in [0, 1), regenerated per row. */
export const rand = (): FunctionCall<DoubleType> => new FunctionCall(double(), { name: 'rand' });

/** Numeric addition. */
export const add = <const L extends NumericOperandInput, const R extends NumericOperandInput>(
  left: L,
  right: R,
): FunctionCall<
  PropagateNull<
    TypeOfOperand<L> | TypeOfOperand<R>,
    NumericResult<TypeOfOperand<L> | TypeOfOperand<R>>
  >
> => {
  const l = toOperand(left);
  const r = toOperand(right);
  return new FunctionCall(propagateNull([l, r], numericResultType([l, r])), {
    name: 'add',
    left: l,
    right: r,
  });
};

/** Numeric subtraction (`left - right`). */
export const subtract = <const L extends NumericOperandInput, const R extends NumericOperandInput>(
  left: L,
  right: R,
): FunctionCall<
  PropagateNull<
    TypeOfOperand<L> | TypeOfOperand<R>,
    NumericResult<TypeOfOperand<L> | TypeOfOperand<R>>
  >
> => {
  const l = toOperand(left);
  const r = toOperand(right);
  return new FunctionCall(propagateNull([l, r], numericResultType([l, r])), {
    name: 'subtract',
    left: l,
    right: r,
  });
};

/** Numeric multiplication. */
export const multiply = <const L extends NumericOperandInput, const R extends NumericOperandInput>(
  left: L,
  right: R,
): FunctionCall<
  PropagateNull<
    TypeOfOperand<L> | TypeOfOperand<R>,
    NumericResult<TypeOfOperand<L> | TypeOfOperand<R>>
  >
> => {
  const l = toOperand(left);
  const r = toOperand(right);
  return new FunctionCall(propagateNull([l, r], numericResultType([l, r])), {
    name: 'multiply',
    left: l,
    right: r,
  });
};

/** Numeric division (`left / right`) — TRUNCATING on an int64 pair (probed); a zero divisor is a backend ERROR value. */
export const divide = <const L extends NumericOperandInput, const R extends NumericOperandInput>(
  left: L,
  right: R,
): FunctionCall<
  PropagateNull<
    TypeOfOperand<L> | TypeOfOperand<R>,
    NumericResult<TypeOfOperand<L> | TypeOfOperand<R>>
  >
> => {
  const l = toOperand(left);
  const r = toOperand(right);
  return new FunctionCall(propagateNull([l, r], numericResultType([l, r])), {
    name: 'divide',
    left: l,
    right: r,
  });
};

/** Modulo (`left % right`). */
export const mod = <const L extends NumericOperandInput, const R extends NumericOperandInput>(
  left: L,
  right: R,
): FunctionCall<
  PropagateNull<
    TypeOfOperand<L> | TypeOfOperand<R>,
    NumericResult<TypeOfOperand<L> | TypeOfOperand<R>>
  >
> => {
  const l = toOperand(left);
  const r = toOperand(right);
  return new FunctionCall(propagateNull([l, r], numericResultType([l, r])), {
    name: 'mod',
    left: l,
    right: r,
  });
};

/** Exponentiation (`base ** exponent`). */
export const pow = <const L extends NumericOperandInput, const R extends NumericOperandInput>(
  base: L,
  exponent: R,
): FunctionCall<PropagateNull<TypeOfOperand<L> | TypeOfOperand<R>, DoubleType>> => {
  const b = toOperand(base);
  const e = toOperand(exponent);
  return new FunctionCall(propagateNull([b, e], double()), { name: 'pow', base: b, exponent: e });
};

/** Absolute value. */
export const abs = <const Op extends NumericOperandInput>(
  value: Op,
): FunctionCall<PropagateNull<TypeOfOperand<Op>, NumericResult<TypeOfOperand<Op>>>> => {
  const v = toOperand(value);
  return new FunctionCall(propagateNull([v], numericResultType([v])), { name: 'abs', value: v });
};

/** Rounds up to the nearest whole number. */
export const ceil = <const Op extends NumericOperandInput>(
  value: Op,
): FunctionCall<PropagateNull<TypeOfOperand<Op>, NumericResult<TypeOfOperand<Op>>>> => {
  const v = toOperand(value);
  return new FunctionCall(propagateNull([v], numericResultType([v])), { name: 'ceil', value: v });
};

/** Rounds down to the nearest whole number. */
export const floor = <const Op extends NumericOperandInput>(
  value: Op,
): FunctionCall<PropagateNull<TypeOfOperand<Op>, NumericResult<TypeOfOperand<Op>>>> => {
  const v = toOperand(value);
  return new FunctionCall(propagateNull([v], numericResultType([v])), { name: 'floor', value: v });
};

/** Square root; a negative operand is a backend ERROR value. */
export const sqrt = <const Op extends NumericOperandInput>(
  value: Op,
): FunctionCall<PropagateNull<TypeOfOperand<Op>, DoubleType>> => {
  const v = toOperand(value);
  return new FunctionCall(propagateNull([v], double()), { name: 'sqrt', value: v });
};

/** The exponential function (e ** operand). */
export const exp = <const Op extends NumericOperandInput>(
  value: Op,
): FunctionCall<PropagateNull<TypeOfOperand<Op>, DoubleType>> => {
  const v = toOperand(value);
  return new FunctionCall(propagateNull([v], double()), { name: 'exp', value: v });
};

/** Natural logarithm; a non-positive operand is a backend ERROR value. */
export const ln = <const Op extends NumericOperandInput>(
  value: Op,
): FunctionCall<PropagateNull<TypeOfOperand<Op>, DoubleType>> => {
  const v = toOperand(value);
  return new FunctionCall(propagateNull([v], double()), { name: 'ln', value: v });
};

/** Base-10 logarithm; a non-positive operand is a backend ERROR value. */
export const log10 = <const Op extends NumericOperandInput>(
  value: Op,
): FunctionCall<PropagateNull<TypeOfOperand<Op>, DoubleType>> => {
  const v = toOperand(value);
  return new FunctionCall(propagateNull([v], double()), { name: 'log10', value: v });
};

// The dual-arity factories (round/trunc, the trim family, substring,
// timestampTruncate/timestampExtract) have ONE signature with an optional
// trailing parameter, mirroring their single payload member. Where the extra
// operand feeds null propagation, its type parameter defaults to `never` so
// the omitted-argument call keeps the unwidened return descriptor
// (`P['type']` is `never`, a no-op union member). The signature carries the
// type-level result; the loose implementation signature is the usual
// runtime-to-type bridge (same shape as `propagateNull`).

/** Rounds to the nearest whole number, or to `decimalPlaces` decimal places. */
export function round<
  const Op extends NumericOperandInput,
  const P extends NumericOperandInput = never,
>(
  value: Op,
  decimalPlaces?: P,
): FunctionCall<
  PropagateNull<TypeOfOperand<Op> | TypeOfOperand<P>, NumericResult<TypeOfOperand<Op>>>
>;
export function round(value: OperandInput, decimalPlaces?: OperandInput): FunctionCall {
  const v = toOperand(value);
  if (decimalPlaces === undefined) {
    return new FunctionCall(propagateNull([v], numericResultType([v])), {
      name: 'round',
      value: v,
    });
  }
  const d = toOperand(decimalPlaces);
  return new FunctionCall(propagateNull([v, d], numericResultType([v])), {
    name: 'round',
    value: v,
    decimalPlaces: d,
  });
}

/** Truncates toward zero, to a whole number or to `decimalPlaces` decimal places. */
export function trunc<
  const Op extends NumericOperandInput,
  const P extends NumericOperandInput = never,
>(
  value: Op,
  decimalPlaces?: P,
): FunctionCall<
  PropagateNull<TypeOfOperand<Op> | TypeOfOperand<P>, NumericResult<TypeOfOperand<Op>>>
>;
export function trunc(value: OperandInput, decimalPlaces?: OperandInput): FunctionCall {
  const v = toOperand(value);
  if (decimalPlaces === undefined) {
    return new FunctionCall(propagateNull([v], numericResultType([v])), {
      name: 'trunc',
      value: v,
    });
  }
  const d = toOperand(decimalPlaces);
  return new FunctionCall(propagateNull([v, d], numericResultType([v])), {
    name: 'trunc',
    value: v,
    decimalPlaces: d,
  });
}

// ---- string ----

/** The number of characters (Unicode code points) in a string. */
export const charLength = <const Op extends StringOperandInput>(
  value: Op,
): FunctionCall<PropagateNull<TypeOfOperand<Op>, Int64Type>> => {
  const v = toOperand(value);
  return new FunctionCall(propagateNull([v], int64()), { name: 'charLength', value: v });
};

/** The number of bytes in a string's UTF-8 encoding. */
export const byteLength = <const Op extends StringOperandInput>(
  value: Op,
): FunctionCall<PropagateNull<TypeOfOperand<Op>, Int64Type>> => {
  const v = toOperand(value);
  return new FunctionCall(propagateNull([v], int64()), { name: 'byteLength', value: v });
};

/** Lowercases a string. */
export const toLower = <const Op extends StringOperandInput>(
  value: Op,
): FunctionCall<PropagateNull<TypeOfOperand<Op>, StringType>> => {
  const v = toOperand(value);
  return new FunctionCall(propagateNull([v], string()), { name: 'toLower', value: v });
};

/** Uppercases a string. */
export const toUpper = <const Op extends StringOperandInput>(
  value: Op,
): FunctionCall<PropagateNull<TypeOfOperand<Op>, StringType>> => {
  const v = toOperand(value);
  return new FunctionCall(propagateNull([v], string()), { name: 'toUpper', value: v });
};

/** Reverses a string. */
export const stringReverse = <const Op extends StringOperandInput>(
  value: Op,
): FunctionCall<PropagateNull<TypeOfOperand<Op>, StringType>> => {
  const v = toOperand(value);
  return new FunctionCall(propagateNull([v], string()), { name: 'stringReverse', value: v });
};

/** Trims whitespace from both ends, or every character of `characters`. */
export function trim<
  const Op extends StringOperandInput,
  const C extends StringOperandInput = never,
>(
  value: Op,
  characters?: C,
): FunctionCall<PropagateNull<TypeOfOperand<Op> | TypeOfOperand<C>, StringType>>;
export function trim(value: OperandInput, characters?: OperandInput): FunctionCall {
  const v = toOperand(value);
  if (characters === undefined) {
    return new FunctionCall(propagateNull([v], string()), { name: 'trim', value: v });
  }
  const c = toOperand(characters);
  return new FunctionCall(propagateNull([v, c], string()), {
    name: 'trim',
    value: v,
    characters: c,
  });
}

/** Trims the leading end — see {@link trim}. */
export function ltrim<
  const Op extends StringOperandInput,
  const C extends StringOperandInput = never,
>(
  value: Op,
  characters?: C,
): FunctionCall<PropagateNull<TypeOfOperand<Op> | TypeOfOperand<C>, StringType>>;
export function ltrim(value: OperandInput, characters?: OperandInput): FunctionCall {
  const v = toOperand(value);
  if (characters === undefined) {
    return new FunctionCall(propagateNull([v], string()), { name: 'ltrim', value: v });
  }
  const c = toOperand(characters);
  return new FunctionCall(propagateNull([v, c], string()), {
    name: 'ltrim',
    value: v,
    characters: c,
  });
}

/** Trims the trailing end — see {@link trim}. */
export function rtrim<
  const Op extends StringOperandInput,
  const C extends StringOperandInput = never,
>(
  value: Op,
  characters?: C,
): FunctionCall<PropagateNull<TypeOfOperand<Op> | TypeOfOperand<C>, StringType>>;
export function rtrim(value: OperandInput, characters?: OperandInput): FunctionCall {
  const v = toOperand(value);
  if (characters === undefined) {
    return new FunctionCall(propagateNull([v], string()), { name: 'rtrim', value: v });
  }
  const c = toOperand(characters);
  return new FunctionCall(propagateNull([v, c], string()), {
    name: 'rtrim',
    value: v,
    characters: c,
  });
}

// The string predicates PROPAGATE null (probed: startsWith(null, 'x') is
// null), unlike the comparison operators, which are total — hence the
// PropagateNull in their return types.

/** Whether `value` starts with `prefix`. */
export const startsWith = <const L extends StringOperandInput, const R extends StringOperandInput>(
  value: L,
  prefix: R,
): FunctionCall<PropagateNull<TypeOfOperand<L> | TypeOfOperand<R>, BoolType>> => {
  const v = toOperand(value);
  const p = toOperand(prefix);
  return new FunctionCall(propagateNull([v, p], bool()), {
    name: 'startsWith',
    value: v,
    prefix: p,
  });
};

/** Whether `value` ends with `suffix`. */
export const endsWith = <const L extends StringOperandInput, const R extends StringOperandInput>(
  value: L,
  suffix: R,
): FunctionCall<PropagateNull<TypeOfOperand<L> | TypeOfOperand<R>, BoolType>> => {
  const v = toOperand(value);
  const s = toOperand(suffix);
  return new FunctionCall(propagateNull([v, s], bool()), { name: 'endsWith', value: v, suffix: s });
};

/** Whether `value` contains `substring`. */
export const stringContains = <
  const L extends StringOperandInput,
  const R extends StringOperandInput,
>(
  value: L,
  substring: R,
): FunctionCall<PropagateNull<TypeOfOperand<L> | TypeOfOperand<R>, BoolType>> => {
  const v = toOperand(value);
  const s = toOperand(substring);
  return new FunctionCall(propagateNull([v, s], bool()), {
    name: 'stringContains',
    value: v,
    substring: s,
  });
};

/** Concatenates two or more strings. */
export const stringConcat = <
  const Ops extends readonly [StringOperandInput, StringOperandInput, ...StringOperandInput[]],
>(
  ...operands: Ops
): FunctionCall<PropagateNull<TypeOfOperand<Ops[number]>, StringType>> => {
  const lifted = liftOperands(operands);
  return new FunctionCall(propagateNull(lifted, string()), {
    name: 'stringConcat',
    operands: lifted,
  });
};

/** The 0-based index of the first occurrence of `substring`, or -1 if absent. */
export const stringIndexOf = <
  const L extends StringOperandInput,
  const R extends StringOperandInput,
>(
  value: L,
  substring: R,
): FunctionCall<PropagateNull<TypeOfOperand<L> | TypeOfOperand<R>, Int64Type>> => {
  const v = toOperand(value);
  const s = toOperand(substring);
  return new FunctionCall(propagateNull([v, s], int64()), {
    name: 'stringIndexOf',
    value: v,
    substring: s,
  });
};

/** Repeats a string `count` times. */
export const stringRepeat = <
  const L extends StringOperandInput,
  const R extends NumericOperandInput,
>(
  value: L,
  count: R,
): FunctionCall<PropagateNull<TypeOfOperand<L> | TypeOfOperand<R>, StringType>> => {
  const v = toOperand(value);
  const c = toOperand(count);
  return new FunctionCall(propagateNull([v, c], string()), {
    name: 'stringRepeat',
    value: v,
    count: c,
  });
};

/** Replaces every occurrence of `find` with `replacement`. */
export const stringReplaceAll = <
  const L extends StringOperandInput,
  const M extends StringOperandInput,
  const R extends StringOperandInput,
>(
  value: L,
  find: M,
  replacement: R,
): FunctionCall<
  PropagateNull<TypeOfOperand<L> | TypeOfOperand<M> | TypeOfOperand<R>, StringType>
> => {
  const v = toOperand(value);
  const f = toOperand(find);
  const r = toOperand(replacement);
  return new FunctionCall(propagateNull([v, f, r], string()), {
    name: 'stringReplaceAll',
    value: v,
    find: f,
    replacement: r,
  });
};

/** Replaces the first occurrence of `find` with `replacement`. */
export const stringReplaceOne = <
  const L extends StringOperandInput,
  const M extends StringOperandInput,
  const R extends StringOperandInput,
>(
  value: L,
  find: M,
  replacement: R,
): FunctionCall<
  PropagateNull<TypeOfOperand<L> | TypeOfOperand<M> | TypeOfOperand<R>, StringType>
> => {
  const v = toOperand(value);
  const f = toOperand(find);
  const r = toOperand(replacement);
  return new FunctionCall(propagateNull([v, f, r], string()), {
    name: 'stringReplaceOne',
    value: v,
    find: f,
    replacement: r,
  });
};

/**
 * The substring from the 0-based `position`, spanning `length` characters or
 * (omitted) to the end of the string.
 */
export function substring<
  const Op extends StringOperandInput,
  const P extends NumericOperandInput,
  const Len extends NumericOperandInput = never,
>(
  value: Op,
  position: P,
  length?: Len,
): FunctionCall<
  PropagateNull<TypeOfOperand<Op> | TypeOfOperand<P> | TypeOfOperand<Len>, StringType>
>;
export function substring(
  value: OperandInput,
  position: OperandInput,
  length?: OperandInput,
): FunctionCall {
  const v = toOperand(value);
  const p = toOperand(position);
  if (length === undefined) {
    return new FunctionCall(propagateNull([v, p], string()), {
      name: 'substring',
      value: v,
      position: p,
    });
  }
  const l = toOperand(length);
  return new FunctionCall(propagateNull([v, p, l], string()), {
    name: 'substring',
    value: v,
    position: p,
    length: l,
  });
}

/** SQL LIKE match (`%` any sequence, `_` any single character). */
export const like = <const L extends StringOperandInput, const R extends StringOperandInput>(
  value: L,
  pattern: R,
): FunctionCall<PropagateNull<TypeOfOperand<L> | TypeOfOperand<R>, BoolType>> => {
  const v = toOperand(value);
  const p = toOperand(pattern);
  return new FunctionCall(propagateNull([v, p], bool()), { name: 'like', value: v, pattern: p });
};

// ---- regex ----
// An invalid pattern is a backend ERROR value (see the error-channel note
// on the arithmetic section).

/** Whether `value` contains a match of the RE2 `pattern`. */
export const regexContains = <
  const L extends StringOperandInput,
  const R extends StringOperandInput,
>(
  value: L,
  pattern: R,
): FunctionCall<PropagateNull<TypeOfOperand<L> | TypeOfOperand<R>, BoolType>> => {
  const v = toOperand(value);
  const p = toOperand(pattern);
  return new FunctionCall(propagateNull([v, p], bool()), {
    name: 'regexContains',
    value: v,
    pattern: p,
  });
};

/** Whether `value` ENTIRELY matches the RE2 `pattern`. */
export const regexMatch = <const L extends StringOperandInput, const R extends StringOperandInput>(
  value: L,
  pattern: R,
): FunctionCall<PropagateNull<TypeOfOperand<L> | TypeOfOperand<R>, BoolType>> => {
  const v = toOperand(value);
  const p = toOperand(pattern);
  return new FunctionCall(propagateNull([v, p], bool()), {
    name: 'regexMatch',
    value: v,
    pattern: p,
  });
};

/**
 * The first match of the RE2 `pattern`, or `null` when there is none — the
 * result is ALWAYS nullable (probed), independent of operand nullability.
 */
export const regexFind = <const L extends StringOperandInput, const R extends StringOperandInput>(
  value: L,
  pattern: R,
): FunctionCall<UnionType<[StringType, NullType]>> => {
  const v = toOperand(value);
  const p = toOperand(pattern);
  return new FunctionCall(nullable(string()), { name: 'regexFind', value: v, pattern: p });
};

/** Every match of the RE2 `pattern` (empty array when there is none). */
export const regexFindAll = <
  const L extends StringOperandInput,
  const R extends StringOperandInput,
>(
  value: L,
  pattern: R,
): FunctionCall<PropagateNull<TypeOfOperand<L> | TypeOfOperand<R>, ArrayType<StringType>>> => {
  const v = toOperand(value);
  const p = toOperand(pattern);
  return new FunctionCall(propagateNull([v, p], array(string())), {
    name: 'regexFindAll',
    value: v,
    pattern: p,
  });
};

// ---- reference ----

/** A reference-domain operand: a `docRef(...)` field or the reserved `'__name__'`. */
type ReferenceOperand = Expression<Valued<'reference'>>;

/** The document id (the path's last segment) of a reference. */
export const documentId = <const Op extends ReferenceOperandInput>(
  reference: Op,
): FunctionCall<PropagateNull<TypeOfOperand<Op>, StringType>> => {
  const r = toOperand(reference);
  return new FunctionCall(propagateNull([r], string()), { name: 'documentId', reference: r });
};

/** The id of the collection containing the referenced document. */
export const collectionId = <const Op extends ReferenceOperandInput>(
  reference: Op,
): FunctionCall<PropagateNull<TypeOfOperand<Op>, StringType>> => {
  const r = toOperand(reference);
  return new FunctionCall(propagateNull([r], string()), { name: 'collectionId', reference: r });
};

// ---- type ----

/**
 * The backend's type-name vocabulary (`type()` results / `isType()`'s `type`
 * argument, per the SDK contract). Note this is the BACKEND's naming
 * (`'int64'` / `'float64'` / `'geo_point'`), not the `firestoreType` tag
 * axis; `'number'` matches both numeric types.
 */
export type FirestoreTypeName =
  | 'null'
  | 'boolean'
  | 'string'
  | 'bytes'
  | 'number'
  | 'int32'
  | 'int64'
  | 'float64'
  | 'decimal128'
  | 'timestamp'
  | 'geo_point'
  | 'reference'
  | 'array'
  | 'map'
  | 'vector'
  | 'max_key'
  | 'min_key'
  | 'object_id'
  | 'regex'
  | 'request_timestamp';

/**
 * The backend type name of the operand's value. Type-OBSERVING: a `null`
 * value yields `'null'` (not a null result), so only ABSENCE propagates —
 * see {@link PropagateAbsence}.
 */
export const type = <const Op extends OperandInput>(
  value: Op,
): FunctionCall<PropagateAbsence<TypeOfOperand<Op>, LiteralType<FirestoreTypeName[]>>> => {
  const v = toOperand(value);
  return new FunctionCall(propagateAbsence([v], typeNameLiteral()), { name: 'type', value: v });
};

/**
 * Whether the operand's value is of the named backend type. The name must be
 * a compile-time literal (the backend requires a constant — probed), stored
 * as a plain payload field; the executors serialize it as the wire constant.
 * Type-observing like {@link type}: only absence propagates.
 */
export const isType = <const Op extends OperandInput>(
  value: Op,
  typeName: FirestoreTypeName,
): FunctionCall<PropagateAbsence<TypeOfOperand<Op>, BoolType>> => {
  const v = toOperand(value);
  return new FunctionCall(propagateAbsence([v], bool()), { name: 'isType', value: v, typeName });
};

/** The `type()` return descriptor: the closed backend type-name vocabulary. */
const typeNameLiteral = (): LiteralType<FirestoreTypeName[]> =>
  literal(
    'null',
    'boolean',
    'string',
    'bytes',
    'number',
    'int32',
    'int64',
    'float64',
    'decimal128',
    'timestamp',
    'geo_point',
    'reference',
    'array',
    'map',
    'vector',
    'max_key',
    'min_key',
    'object_id',
    'regex',
    'request_timestamp',
  );

// ---- array ----
// The contains family propagates the ARRAY operand's null/absence, while a
// null ELEMENT operand is compared as a value (probed:
// `arrayContains([1, null, 3], null)` is true, over a null-free array
// false). `arrayContainsAll`/`arrayContainsAny` take one array-typed
// options expression, like `equalAny`.

/** An array-domain operand. */
type ArrayOperand = Expression<Valued<readonly FirestoreType[]>>;

/** The deduped element-type union of a tuple of element expressions. */
type ElementUnion<Els extends readonly Expression[]> = RebuildUnion<
  DedupDescriptors<ElementTypes<Els>>
>;
type ElementTypes<Els extends readonly Expression[]> = Els extends readonly [
  infer H extends Expression,
  ...infer R extends readonly Expression[],
]
  ? [WithoutOptional<H['type']>, ...ElementTypes<R>]
  : [];

/** Runtime counterpart of {@link ElementUnion} (same bridge shape as `propagateNull`). */
function elementUnionType<Els extends readonly Expression[]>(elements: Els): ElementUnion<Els>;
function elementUnionType(elements: readonly Expression[]): FieldType {
  const [first, ...rest] = elements
    .map((e) => withoutOptional(e.type))
    .filter((t, i, all) => all.findIndex((o) => descriptorEquals(o, t)) === i);
  if (first === undefined) {
    throw new Error('an element list must not be empty');
  }
  return rest.length === 0 ? first : union(first, ...rest);
}

/**
 * Builds an array EXPRESSION — `arrayValue([field('a'), constant(1)])`.
 * Unlike the value nodes (which hold plain values and enter expressions via
 * `constant()`), the elements here are expressions, evaluated per row
 * (probed: fields nest arbitrarily). Non-empty, mirroring `constant([])`'s
 * rejection: an empty literal has no element to infer a descriptor from.
 */
export const arrayValue = <const Els extends readonly [OperandInput, ...OperandInput[]]>(
  elements: Els,
): FunctionCall<ArrayType<ElementUnion<LiftedOperands<Els>>>> => {
  const lifted = liftOperands(elements);
  return new FunctionCall(array(elementUnionType(lifted)), {
    name: 'arrayValue',
    elements: lifted,
  });
};

/** The number of elements. */
export const arrayLength = <const Op extends ArrayOperandInput>(
  value: Op,
): FunctionCall<PropagateNull<TypeOfOperand<Op>, Int64Type>> => {
  const v = toOperand(value);
  return new FunctionCall(propagateNull([v], int64()), { name: 'arrayLength', value: v });
};

/** The array reversed. */
export const arrayReverse = <const Op extends ArrayOperandInput>(
  value: Op,
): FunctionCall<PropagateNull<TypeOfOperand<Op>, StripNull<TypeOfOperand<Op>>>> => {
  const v = toOperand(value);
  return new FunctionCall(propagateNull([v], stripNullOf(v)), { name: 'arrayReverse', value: v });
};

/** Runtime counterpart of `StripNull<Op['type']>` over an expression (same bridge shape as `propagateNull`). */
function stripNullOf<Op extends Expression>(value: Op): StripNull<Op['type']>;
function stripNullOf(value: Expression): FieldType {
  return stripNull(value.type) ?? nullType();
}

/**
 * The element at `index` (dynamic allowed; negative counts from the end —
 * probed). Always nullable: an out-of-range index yields an ABSENT result
 * (not an error), approximated as null in the descriptor, like `regexFind`'s
 * no-match.
 */
export const arrayGet = <
  const Arr extends ArrayOperandInput,
  const Idx extends NumericOperandInput,
>(
  value: Arr,
  index: Idx,
): FunctionCall<UnionType<[ElementsOf<StripNull<TypeOfOperand<Arr>>>, NullType]>> => {
  const v = toOperand(value);
  const i = toOperand(index);
  return new FunctionCall(nullable(elementTypeOf(v)), { name: 'arrayGet', value: v, index: i });
};

/** Runtime counterpart of `ElementsOf<StripNull<...>>` (same bridge shape as `propagateNull`). */
function elementTypeOf<Arr extends Expression>(value: Arr): ElementsOf<StripNull<Arr['type']>>;
function elementTypeOf(value: Expression): FieldType {
  const t = stripNull(value.type);
  if (t === undefined || t.type !== 'array') {
    throw new Error('operand is not an array');
  }
  return t.dynamicPart;
}

/** Whether the array contains the element (a null element is compared as a value). */
export const arrayContains = <const Arr extends ArrayOperandInput, const El extends OperandInput>(
  value: Arr,
  element: El & Comparable<ElementsOf<StripNull<TypeOfOperand<Arr>>>, TypeOfOperand<El>>,
): FunctionCall<PropagateNull<TypeOfOperand<Arr>, BoolType>> => {
  const v = toOperand(value);
  const e = toOperand(element);
  return new FunctionCall(propagateNull([v], bool()), {
    name: 'arrayContains',
    value: v,
    element: e,
  });
};

/** Whether the array contains EVERY element of the options array. */
export const arrayContainsAll = <
  const Arr extends ArrayOperandInput,
  const Opts extends ArrayOperandInput,
>(
  value: Arr,
  options: Opts &
    Comparable<
      ElementsOf<StripNull<TypeOfOperand<Arr>>>,
      ElementsOf<StripNull<TypeOfOperand<Opts>>>
    >,
): FunctionCall<PropagateNull<TypeOfOperand<Arr> | TypeOfOperand<Opts>, BoolType>> => {
  const v = toOperand(value);
  // Drop the `& Comparable<...>` guard before lifting: the guard constrains
  // the CALLER but must not leak into the operand's descriptor computation.
  const opts: Opts = options;
  const o = toOperand(opts);
  return new FunctionCall(propagateNull([v, o], bool()), {
    name: 'arrayContainsAll',
    value: v,
    options: o,
  });
};

/** Whether the array contains ANY element of the options array. */
export const arrayContainsAny = <
  const Arr extends ArrayOperandInput,
  const Opts extends ArrayOperandInput,
>(
  value: Arr,
  options: Opts &
    Comparable<
      ElementsOf<StripNull<TypeOfOperand<Arr>>>,
      ElementsOf<StripNull<TypeOfOperand<Opts>>>
    >,
): FunctionCall<PropagateNull<TypeOfOperand<Arr> | TypeOfOperand<Opts>, BoolType>> => {
  const v = toOperand(value);
  // Drop the `& Comparable<...>` guard before lifting (see arrayContainsAll).
  const opts: Opts = options;
  const o = toOperand(opts);
  return new FunctionCall(propagateNull([v, o], bool()), {
    name: 'arrayContainsAny',
    value: v,
    options: o,
  });
};

/** The concatenation of two or more arrays. */
export const arrayConcat = <
  const Ops extends readonly [ArrayOperandInput, ArrayOperandInput, ...ArrayOperandInput[]],
>(
  ...operands: Ops
): FunctionCall<
  PropagateNull<TypeOfOperand<Ops[number]>, ArrayType<ConcatElementUnion<LiftedOperands<Ops>>>>
> => {
  const lifted = liftOperands(operands);
  return new FunctionCall(propagateNull(lifted, array(concatElementUnionType(lifted))), {
    name: 'arrayConcat',
    operands: lifted,
  });
};

type ConcatElementUnion<Ops extends readonly Expression[]> = RebuildUnion<
  DedupDescriptors<ConcatElementTypes<Ops>>
>;
type ConcatElementTypes<Ops extends readonly Expression[]> = Ops extends readonly [
  infer H extends Expression,
  ...infer R extends readonly Expression[],
]
  ? [ElementsOf<StripNull<H['type']>>, ...ConcatElementTypes<R>]
  : [];

/** Runtime counterpart of {@link ConcatElementUnion}. */
function concatElementUnionType<Ops extends readonly Expression[]>(
  operands: Ops,
): ConcatElementUnion<Ops>;
function concatElementUnionType(operands: readonly Expression[]): FieldType {
  const [first, ...rest] = operands
    .map((operand) => elementTypeOf(operand))
    .filter((t, i, all) => all.findIndex((o) => descriptorEquals(o, t)) === i);
  if (first === undefined) {
    throw new Error('arrayConcat needs at least one operand');
  }
  return rest.length === 0 ? first : union(first, ...rest);
}

// ---- map ----
// `mapSet` / `mapRemove` keys must be literal constants (probed:
// "map_set keys must be constants/literals"), so they are plain payload
// fields like `isType`'s type name, serialized as wire constants by the
// executors. `mapGet`'s key MAY be dynamic on the backend, but the factory
// takes a literal so the result subschema is key-aware; a dynamic-key
// overload is deferred.

/** A map-domain operand. */
type MapOperand = Expression<Valued<{ readonly [field: string]: FirestoreType }>>;

/** The fields record of a map descriptor (wide/lenient for imprecise inputs). */
type FieldsOf<T extends FieldType> = T extends { type: 'map'; fields: infer F extends FieldsRecord }
  ? F
  : FieldsRecord;
type FieldsRecord = Record<string, FieldType>;

/** The literal keys addressable on the operand (any string for imprecise maps). */
type MapKeysOf<T extends FieldType> =
  FieldsRecord extends FieldsOf<StripNull<T>> ? string : keyof FieldsOf<StripNull<T>> & string;

/**
 * The value at a literal key. A missing key yields an ABSENT result
 * (probed), so an `Optional` field reads as nullable; a null/absent map
 * yields null.
 */
export const mapGet = <const M extends MapOperandInput, K extends MapKeysOf<TypeOfOperand<M>>>(
  value: M,
  key: K,
): FunctionCall<
  PropagateNull<TypeOfOperand<M>, MapValueType<FieldsOf<StripNull<TypeOfOperand<M>>>[K]>>
> => {
  const v = toOperand(value);
  return new FunctionCall(propagateNull([v], mapValueTypeOf(v, key)), {
    name: 'mapGet',
    value: v,
    key,
  });
};

type MapValueType<V extends FieldType> = [Extract<V, Optional>] extends [never]
  ? V
  : UnionType<[WithoutOptional<V>, NullType]>;

/** Runtime counterpart of `MapValueType<FieldsOf<...>[K]>` (same bridge shape as `propagateNull`). */
function mapValueTypeOf<M extends Expression, K extends string>(
  value: M,
  key: K,
): MapValueType<FieldsOf<StripNull<M['type']>>[K]>;
function mapValueTypeOf(value: Expression, key: string): FieldType {
  const t = stripNull(value.type);
  if (t === undefined || t.type !== 'map') {
    throw new Error('operand is not a map');
  }
  const v = t.fields[key];
  if (v === undefined) {
    throw new Error(`map has no field "${key}"`);
  }
  return mayBeAbsent(v) ? nullable(withoutOptional(v)) : v;
}

/**
 * `MapType` constructor for COMPUTED field records: the public `map()`
 * factory's dotted-name F-bound cannot be discharged for a generically
 * computed record, so dotted keys are rejected at runtime here instead
 * (same policy — dots are the path separator).
 */
const mapDescriptor = <F extends FieldsRecord>(fields: F): MapType<F> => {
  assertNoDottedFieldNames(fields);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- phantom input/output/firestoreType exist only at the type level (the schema factories' buildType precedent)
  return { type: 'map', fields } as MapType<F>;
};

/** A record whose dotted keys are banned (the schema factories' rule — dots are the path separator). */
type WithoutDottedKeys<F> = {
  [K in keyof F]: K extends `${string}.${string}` ? never : F[K];
};
/** A key literal that must not contain the path separator. */
type UndottedKey<K extends string> = K extends `${string}.${string}` ? never : K;

/** Builds a map EXPRESSION from field-value expressions — `mapValue({ x: field('num') })`. See {@link arrayValue}. */
export const mapValue = <const F extends Readonly<Record<string, OperandInput>>>(
  fields: F & WithoutDottedKeys<F>,
): FunctionCall<MapType<{ [K in keyof F & string]: WithoutOptional<TypeOfOperand<F[K]>> }>> => {
  // Drop the `& WithoutDottedKeys<F>` guard before lifting: it constrains the
  // CALLER's keys but must not leak into the field descriptors' computation.
  const clean: F = fields;
  const lifted = liftFields(clean);
  return new FunctionCall(mapDescriptor(mapValueFields(lifted)), {
    name: 'mapValue',
    fields: lifted,
  });
};

/** Runtime counterpart of `mapValue`'s fields record (same bridge shape as `propagateNull`). */
function mapValueFields<F extends Readonly<Record<string, Expression>>>(
  fields: F,
): { [K in keyof F & string]: WithoutOptional<F[K]['type']> };
function mapValueFields(fields: Readonly<Record<string, Expression>>): FieldsRecord {
  return Object.fromEntries(Object.entries(fields).map(([k, e]) => [k, withoutOptional(e.type)]));
}

/** The map's keys, as a string array. */
export const mapKeys = <const M extends MapOperandInput>(
  value: M,
): FunctionCall<PropagateNull<TypeOfOperand<M>, ArrayType<StringType>>> => {
  const v = toOperand(value);
  return new FunctionCall(propagateNull([v], array(string())), { name: 'mapKeys', value: v });
};

/** The map's values, as an array of the deduped field-type union. */
export const mapValues = <const M extends MapOperandInput>(
  value: M,
): FunctionCall<
  PropagateNull<TypeOfOperand<M>, ArrayType<MapFieldUnion<FieldsOf<StripNull<TypeOfOperand<M>>>>>>
> => {
  const v = toOperand(value);
  return new FunctionCall(propagateNull([v], array(mapFieldUnionType(v))), {
    name: 'mapValues',
    value: v,
  });
};

/** The map's entries, as an array of `{ k, v }` maps (probed shape). */
export const mapEntries = <const M extends MapOperandInput>(
  value: M,
): FunctionCall<
  PropagateNull<
    TypeOfOperand<M>,
    ArrayType<MapType<{ k: StringType; v: MapFieldUnion<FieldsOf<StripNull<TypeOfOperand<M>>>> }>>
  >
> => {
  const v = toOperand(value);
  return new FunctionCall(
    propagateNull([v], array(map({ k: string(), v: mapFieldUnionType(v) }))),
    { name: 'mapEntries', value: v },
  );
};

/**
 * The element descriptor of a map's value collection. Key order is not
 * observable at the type level (a record has no ordered key tuple), so a
 * multi-type map degrades to the widest union descriptor — the runtime
 * builds the concrete `UnionType`, a structural subtype of it. A
 * single-type map keeps the precise descriptor; an empty map yields null
 * values (runtime mirror: `mapFieldUnionType`).
 */
type MapFieldUnion<F extends FieldsRecord> = FieldsRecord extends F
  ? AnyUnionType
  : WithoutOptional<F[keyof F & string]> extends infer Vals extends FieldType
    ? [Vals] extends [never]
      ? NullType
      : IsUnion<Vals> extends true
        ? AnyUnionType
        : Vals
    : never;

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;

/** Runtime counterpart of {@link MapFieldUnion} (same bridge shape as `propagateNull`). */
function mapFieldUnionType<M extends Expression>(
  value: M,
): MapFieldUnion<FieldsOf<StripNull<M['type']>>>;
function mapFieldUnionType(value: Expression): FieldType {
  const t = stripNull(value.type);
  if (t === undefined || t.type !== 'map') {
    throw new Error('operand is not a map');
  }
  const [first, ...rest] = Object.values(t.fields)
    .map((v) => withoutOptional(v))
    .filter((v, i, all) => all.findIndex((o) => descriptorEquals(o, v)) === i);
  if (first === undefined) {
    return nullType();
  }
  return rest.length === 0 ? first : union(first, ...rest);
}

/**
 * The map with `key` set to the value (shallow; probed: a later value wins).
 * The key must be a literal constant (backend-validated) — a plain payload
 * field like `isType`'s type name, serialized as a wire constant by the
 * executors.
 */
export const mapSet = <
  const M extends MapOperandInput,
  K extends string,
  const V extends OperandInput,
>(
  value: M,
  key: K & UndottedKey<K>,
  entry: V,
): FunctionCall<
  PropagateNull<
    TypeOfOperand<M>,
    MapType<
      SetField<
        FieldsOf<StripNull<TypeOfOperand<M>>>,
        K & UndottedKey<K>,
        WithoutOptional<TypeOfOperand<V>>
      >
    >
  >
> => {
  const v = toOperand(value);
  const e = toOperand(entry);
  return new FunctionCall(propagateNull([v], mapDescriptor(setField(v, key, e))), {
    name: 'mapSet',
    value: v,
    key,
    entry: e,
  });
};

type SetField<F extends FieldsRecord, K extends string, V extends FieldType> = {
  [P in keyof F as P extends K ? never : P]: F[P];
} & { [P in K]: V };

/** Runtime counterpart of {@link SetField} (same bridge shape as `propagateNull`). */
function setField<M extends Expression, K extends string, V extends Expression>(
  value: M,
  key: K,
  entry: V,
): SetField<FieldsOf<StripNull<M['type']>>, K, WithoutOptional<V['type']>>;
function setField(value: Expression, key: string, entry: Expression): FieldsRecord {
  const t = stripNull(value.type);
  if (t === undefined || t.type !== 'map') {
    throw new Error('operand is not a map');
  }
  return { ...t.fields, [key]: withoutOptional(entry.type) };
}

/** The map without `key` (a missing key is a no-op — probed). Literal key, like {@link mapSet}. */
export const mapRemove = <const M extends MapOperandInput, K extends string>(
  value: M,
  key: K & UndottedKey<K>,
): FunctionCall<
  PropagateNull<
    TypeOfOperand<M>,
    MapType<Omit<FieldsOf<StripNull<TypeOfOperand<M>>>, K & UndottedKey<K>>>
  >
> => {
  const v = toOperand(value);
  return new FunctionCall(propagateNull([v], mapDescriptor(removeField(v, key))), {
    name: 'mapRemove',
    value: v,
    key,
  });
};

/** Runtime counterpart of `mapRemove`'s fields record (same bridge shape as `propagateNull`). */
function removeField<M extends Expression, K extends string>(
  value: M,
  key: K,
): Omit<FieldsOf<StripNull<M['type']>>, K>;
function removeField(value: Expression, key: string): FieldsRecord {
  const t = stripNull(value.type);
  if (t === undefined || t.type !== 'map') {
    throw new Error('operand is not a map');
  }
  const { [key]: _removed, ...rest } = t.fields;
  return rest;
}

/**
 * The shallow merge of two or more maps — a later operand's key wins (probed).
 * A raw plain object lifts to a map CONSTANT (`mapMerge(m, { z: 1 })` is
 * `mapMerge(m, constant({ z: 1 }))`), NOT a `mapValue(...)` constructor node.
 */
export const mapMerge = <
  const Ops extends readonly [MapOperandInput, MapOperandInput, ...MapOperandInput[]],
>(
  ...operands: Ops
): FunctionCall<
  PropagateNull<TypeOfOperand<Ops[number]>, MapType<MergeFields<LiftedOperands<Ops>>>>
> => {
  const lifted = liftOperands(operands);
  return new FunctionCall(propagateNull(lifted, mapDescriptor(mergeFields(lifted))), {
    name: 'mapMerge',
    operands: lifted,
  });
};

type MergeFields<Ops extends readonly Expression[]> = Ops extends readonly [
  infer H extends Expression,
  ...infer R extends readonly Expression[],
]
  ? MergeTwo<FieldsOf<StripNull<H['type']>>, MergeFields<R>>
  : // oxlint-disable-next-line typescript/no-empty-object-type -- the fold's identity element: "no fields yet"
    {};
type MergeTwo<A extends FieldsRecord, B> = {
  [P in keyof A as P extends keyof B ? never : P]: A[P];
} & B;

/** Runtime counterpart of {@link MergeFields} (same bridge shape as `propagateNull`). */
function mergeFields<Ops extends readonly Expression[]>(operands: Ops): MergeFields<Ops>;
function mergeFields(operands: readonly Expression[]): FieldsRecord {
  return operands.reduce<FieldsRecord>((acc, operand) => {
    const t = stripNull(operand.type);
    if (t === undefined || t.type !== 'map') {
      throw new Error('operand is not a map');
    }
    return { ...acc, ...t.fields };
  }, {});
}

// ---- existence & error ----
// The error channel (probed): backend ERROR values (divide by zero, invalid
// regex, out-of-range timestamps, ...) propagate through every function and
// fail the query if they surface in a projection; `isError` / `ifError` are
// the only observers. Null and absent are NOT errors.

/**
 * Whether the field is present on the document (`true` for a present null —
 * absence-observing and total). The backend requires a FIELD REFERENCE here
 * (probed: any other expression, constants included, is INVALID_ARGUMENT),
 * so the factory takes a `Field`, not a general expression.
 */
export const exists = <F extends Field>(target: F): FunctionCall<BoolType> =>
  new FunctionCall(bool(), { name: 'exists', target });

/** Whether the field is absent from the document — the negation of {@link exists}, with the same field-reference-only constraint. */
export const isAbsent = <F extends Field>(target: F): FunctionCall<BoolType> =>
  new FunctionCall(bool(), { name: 'isAbsent', target });

/** Whether the operand evaluates to a backend ERROR value (total: null/absent are `false`). */
export const isError = <const Op extends OperandInput>(value: Op): FunctionCall<BoolType> =>
  new FunctionCall(bool(), { name: 'isError', value: toOperand(value) });

/**
 * The `try` value, or the `catch` value if `try` evaluates to a backend
 * ERROR. Null and absent pass through the `try` side untouched (probed) —
 * they are values, not errors.
 */
export const ifError = <const T extends OperandInput, const C extends OperandInput>(
  tryExpr: T,
  catchExpr: C,
): FunctionCall<
  PropagateAbsence<TypeOfOperand<T>, EitherType<TypeOfOperand<T>, TypeOfOperand<C>>>
> => {
  const t = toOperand(tryExpr);
  const c = toOperand(catchExpr);
  return new FunctionCall(propagateAbsence([t], eitherType(t, c)), {
    name: 'ifError',
    tryExpr: t,
    catchExpr: c,
  });
};

/**
 * The value, or the fallback when the value is ABSENT. A present null passes
 * through (probed) — absence is the only trigger. An ERROR propagates.
 */
export const ifAbsent = <const T extends OperandInput, const C extends OperandInput>(
  value: T,
  fallback: C,
): FunctionCall<EitherType<TypeOfOperand<T>, TypeOfOperand<C>>> => {
  const v = toOperand(value);
  const f = toOperand(fallback);
  return new FunctionCall(eitherType(v, f), { name: 'ifAbsent', value: v, fallback: f });
};

/**
 * The value, or the fallback when the value is null OR absent (probed:
 * absence merges into null here, unlike {@link ifAbsent}). The pass-through
 * side is null-stripped in the return descriptor — a value that got past
 * the check cannot be null. An ERROR propagates.
 */
export const ifNull = <const T extends OperandInput, const C extends OperandInput>(
  value: T,
  fallback: C,
): FunctionCall<EitherType<StripNull<TypeOfOperand<T>>, TypeOfOperand<C>>> => {
  const v = toOperand(value);
  const f = toOperand(fallback);
  return new FunctionCall(ifNullType(v, f), { name: 'ifNull', value: v, fallback: f });
};

/** Runtime counterpart of `ifNull`'s return descriptor (same bridge shape as `propagateNull`). */
function ifNullType<T extends Expression, C extends Expression>(
  value: T,
  fallback: C,
): EitherType<StripNull<T['type']>, C['type']>;
function ifNullType(value: Expression, fallback: Expression): FieldType {
  return fallbackType(stripNull(value.type), fallback.type);
}

// ---- timestamp ----
// The unit/granularity/part argument and the timezone argument must be
// compile-time literals: the backend validates them as literal constants
// (probed: a field operand is INVALID_ARGUMENT at query validation, not an
// ERROR value), so the factories take literal parameters stored as plain
// payload fields, like `isType`'s type name — the executors serialize them
// as wire constants. Out-of-range results and invalid timezone
// VALUES, by contrast, are backend ERROR values (`isError`-catchable).
// Integer-only positions (an add/subtract amount, a unix epoch input) are
// typed as the numeric domain: `'integer'` alone cannot be demanded at the
// type level (a number-valued descriptor honestly carries
// `'integer' | 'double'` — see `Int64Type`), and a whole `number` wire-encodes
// as an integer anyway; an actually-fractional value is a backend error.

/** The time units accepted by `timestampAdd` / `timestampSubtract` / `timestampDiff`. */
export type TimeUnit = 'microsecond' | 'millisecond' | 'second' | 'minute' | 'hour' | 'day';
type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
/**
 * The truncation granularities of `timestampTruncate`. Bare `'week'` starts
 * weeks on Sunday; `'week(<day>)'` picks the start day; `'isoweek'` is
 * `'week(monday)'` (probed).
 */
export type TimeGranularity =
  | TimeUnit
  | 'week'
  | `week(${Weekday})`
  | 'isoweek'
  | 'month'
  | 'quarter'
  | 'year'
  | 'isoyear';
/** The extractable parts of `timestampExtract`. */
export type TimePart = TimeGranularity | 'dayofweek' | 'dayofyear';

/** A timestamp-domain operand. */
type TimestampOperand = Expression<Valued<'timestamp'>>;

/** The server's timestamp at query evaluation time. */
export const currentTimestamp = (): FunctionCall<TimestampType> =>
  new FunctionCall(timestamp(), { name: 'currentTimestamp' });

/** The operand as a unix epoch in seconds (fractions truncated toward zero). */
export const timestampToUnixSeconds = <const Op extends TimestampOperandInput>(
  value: Op,
): FunctionCall<PropagateNull<TypeOfOperand<Op>, Int64Type>> => {
  const v = toOperand(value);
  return new FunctionCall(propagateNull([v], int64()), {
    name: 'timestampToUnixSeconds',
    value: v,
  });
};

/** The operand as a unix epoch in milliseconds. */
export const timestampToUnixMillis = <const Op extends TimestampOperandInput>(
  value: Op,
): FunctionCall<PropagateNull<TypeOfOperand<Op>, Int64Type>> => {
  const v = toOperand(value);
  return new FunctionCall(propagateNull([v], int64()), { name: 'timestampToUnixMillis', value: v });
};

/** The operand as a unix epoch in microseconds. */
export const timestampToUnixMicros = <const Op extends TimestampOperandInput>(
  value: Op,
): FunctionCall<PropagateNull<TypeOfOperand<Op>, Int64Type>> => {
  const v = toOperand(value);
  return new FunctionCall(propagateNull([v], int64()), { name: 'timestampToUnixMicros', value: v });
};

/** The timestamp at the given unix epoch in seconds (integers only — a fractional value is a backend error). */
export const unixSecondsToTimestamp = <const Op extends NumericOperandInput>(
  value: Op,
): FunctionCall<PropagateNull<TypeOfOperand<Op>, TimestampType>> => {
  const v = toOperand(value);
  return new FunctionCall(propagateNull([v], timestamp()), {
    name: 'unixSecondsToTimestamp',
    value: v,
  });
};

/** The timestamp at the given unix epoch in milliseconds (integers only). */
export const unixMillisToTimestamp = <const Op extends NumericOperandInput>(
  value: Op,
): FunctionCall<PropagateNull<TypeOfOperand<Op>, TimestampType>> => {
  const v = toOperand(value);
  return new FunctionCall(propagateNull([v], timestamp()), {
    name: 'unixMillisToTimestamp',
    value: v,
  });
};

/** The timestamp at the given unix epoch in microseconds (integers only). */
export const unixMicrosToTimestamp = <const Op extends NumericOperandInput>(
  value: Op,
): FunctionCall<PropagateNull<TypeOfOperand<Op>, TimestampType>> => {
  const v = toOperand(value);
  return new FunctionCall(propagateNull([v], timestamp()), {
    name: 'unixMicrosToTimestamp',
    value: v,
  });
};

/** The timestamp moved forward by `amount` `unit`s (out-of-range results are backend ERROR values). */
export const timestampAdd = <
  const Ts extends TimestampOperandInput,
  const Amount extends NumericOperandInput,
>(
  value: Ts,
  unit: TimeUnit,
  amount: Amount,
): FunctionCall<PropagateNull<TypeOfOperand<Ts> | TypeOfOperand<Amount>, TimestampType>> => {
  const v = toOperand(value);
  const a = toOperand(amount);
  return new FunctionCall(propagateNull([v, a], timestamp()), {
    name: 'timestampAdd',
    value: v,
    unit,
    amount: a,
  });
};

/** The timestamp moved backward by `amount` `unit`s. */
export const timestampSubtract = <
  const Ts extends TimestampOperandInput,
  const Amount extends NumericOperandInput,
>(
  value: Ts,
  unit: TimeUnit,
  amount: Amount,
): FunctionCall<PropagateNull<TypeOfOperand<Ts> | TypeOfOperand<Amount>, TimestampType>> => {
  const v = toOperand(value);
  const a = toOperand(amount);
  return new FunctionCall(propagateNull([v, a], timestamp()), {
    name: 'timestampSubtract',
    value: v,
    unit,
    amount: a,
  });
};

/**
 * `end - start` in whole `unit`s, truncated toward zero (probed: 2.6 days →
 * `2`; negative when `end` precedes `start`). Units only — calendar
 * granularities (`'week'`, `'month'`, ...) are rejected by the backend.
 */
export const timestampDiff = <
  const End extends TimestampOperandInput,
  const Start extends TimestampOperandInput,
>(
  end: End,
  start: Start,
  unit: TimeUnit,
): FunctionCall<PropagateNull<TypeOfOperand<End> | TypeOfOperand<Start>, Int64Type>> => {
  const e = toOperand(end);
  const s = toOperand(start);
  return new FunctionCall(propagateNull([e, s], int64()), {
    name: 'timestampDiff',
    end: e,
    start: s,
    unit,
  });
};

/**
 * The timestamp truncated down to the given granularity, in the given IANA
 * timezone (default UTC). An invalid timezone VALUE is a backend ERROR value.
 */
export const timestampTruncate = <const Ts extends TimestampOperandInput>(
  value: Ts,
  granularity: TimeGranularity,
  timezone?: string,
): FunctionCall<PropagateNull<TypeOfOperand<Ts>, TimestampType>> => {
  const v = toOperand(value);
  return new FunctionCall(
    propagateNull([v], timestamp()),
    timezone === undefined
      ? { name: 'timestampTruncate', value: v, granularity }
      : { name: 'timestampTruncate', value: v, granularity, timezone },
  );
};

/**
 * The given part of the timestamp as an integer, in the given IANA timezone
 * (default UTC). `'dayofweek'` is 1-based from Sunday (probed: a Friday →
 * `6`).
 */
export const timestampExtract = <const Ts extends TimestampOperandInput>(
  value: Ts,
  part: TimePart,
  timezone?: string,
): FunctionCall<PropagateNull<TypeOfOperand<Ts>, Int64Type>> => {
  const v = toOperand(value);
  return new FunctionCall(
    propagateNull([v], int64()),
    timezone === undefined
      ? { name: 'timestampExtract', value: v, part }
      : { name: 'timestampExtract', value: v, part, timezone },
  );
};

// ---- vector ----
// Distance functions over mismatched dimensions are backend ERROR values.

/** A vector-domain operand: a `vector()` field or a `vectorValue(...)` node. */
type VectorOperand = Expression<Valued<'vector'>>;

/** The cosine distance between two vectors. */
export const cosineDistance = <
  const L extends VectorOperandInput,
  const R extends VectorOperandInput,
>(
  left: L,
  right: R,
): FunctionCall<PropagateNull<TypeOfOperand<L> | TypeOfOperand<R>, DoubleType>> => {
  const l = toOperand(left);
  const r = toOperand(right);
  return new FunctionCall(propagateNull([l, r], double()), {
    name: 'cosineDistance',
    left: l,
    right: r,
  });
};

/** The dot product of two vectors. */
export const dotProduct = <const L extends VectorOperandInput, const R extends VectorOperandInput>(
  left: L,
  right: R,
): FunctionCall<PropagateNull<TypeOfOperand<L> | TypeOfOperand<R>, DoubleType>> => {
  const l = toOperand(left);
  const r = toOperand(right);
  return new FunctionCall(propagateNull([l, r], double()), {
    name: 'dotProduct',
    left: l,
    right: r,
  });
};

/** The euclidean distance between two vectors. */
export const euclideanDistance = <
  const L extends VectorOperandInput,
  const R extends VectorOperandInput,
>(
  left: L,
  right: R,
): FunctionCall<PropagateNull<TypeOfOperand<L> | TypeOfOperand<R>, DoubleType>> => {
  const l = toOperand(left);
  const r = toOperand(right);
  return new FunctionCall(propagateNull([l, r], double()), {
    name: 'euclideanDistance',
    left: l,
    right: r,
  });
};

/** The number of dimensions of a vector. */
export const vectorLength = <const Op extends VectorOperandInput>(
  vector: Op,
): FunctionCall<PropagateNull<TypeOfOperand<Op>, Int64Type>> => {
  const v = toOperand(vector);
  return new FunctionCall(propagateNull([v], int64()), { name: 'vectorLength', vector: v });
};
