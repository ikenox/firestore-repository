import {
  type AnyUnionType,
  array,
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
export type Expression<T extends FieldType = FieldType> =
  | Field<T>
  | Constant<T>
  | NullaryFunction<T>
  | UnaryFunction<T>
  | BinaryFunction<T>
  | TernaryFunction<T>
  | VariadicFunction<T>
  | ArrayConstructor<T>
  | MapConstructor<T>;

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
export class DocRefValue {
  readonly type: DocRefType<'unknown'> = docRef();
  readonly path: readonly string[];
  constructor(path: readonly string[]) {
    this.path = [...path];
  }
}

/** Builds a document-reference value — see {@link DocRefValue}. */
export const docRefValue = (path: readonly string[]): DocRefValue => new DocRefValue(path);

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
export type ConstantLeafNode = GeoPointValue | VectorValue | DocRefValue;
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
        : V extends DocRefValue
          ? DocRefType<'unknown'>
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
 * the planned `arrayValue` / `mapValue` constructor naming.
 */
export const geoPointValue = (latitude: number, longitude: number): GeoPointValue =>
  new GeoPointValue(latitude, longitude);

/** Builds a vector value from explicit components — see {@link VectorValue}. */
export const vectorValue = (values: readonly number[]): VectorValue => new VectorValue(values);

// Function-call nodes are grouped by SHAPE (arity), not one class per
// function: each shape carries typed payload fields (no untyped `args` array,
// so executors need no runtime arity guards), and its `name` is a
// string-literal union so an executor can translate a whole shape with an
// exhaustive `Record<Name, ...>` lookup. Per-function individuality (operand
// compatibility, return types) lives in the factory signatures. See
// "Restructure FunctionCall" in docs/plan/pipeline-query.md.

/** A function call with no operands. */
export class NullaryFunction<T extends FieldType = FieldType> extends ExpressionBase {
  readonly kind = 'nullaryFunction';
  constructor(
    readonly name: NullaryFunctionName,
    readonly type: T,
  ) {
    super();
  }
}
export type NullaryFunctionName = 'rand' | 'currentTimestamp';

/** A function call with a single operand. */
export class UnaryFunction<T extends FieldType = FieldType> extends ExpressionBase {
  readonly kind = 'unaryFunction';
  constructor(
    readonly name: UnaryFunctionName,
    readonly type: T,
    readonly operand: Expression,
  ) {
    super();
  }
}
// A name appearing in two shape unions (round/trunc/trim/ltrim/rtrim) is the
// dual-arity pattern: the factory overloads to a unary and a binary form and
// each executor table translates its own arity.
// The name unions are ordered by function CATEGORY (matching the factory
// sections below), not by anything historical.
export type UnaryFunctionName =
  // logical
  | 'not'
  // arithmetic
  | 'abs'
  | 'ceil'
  | 'floor'
  | 'round'
  | 'trunc'
  | 'sqrt'
  | 'exp'
  | 'ln'
  | 'log10'
  // string
  | 'charLength'
  | 'byteLength'
  | 'toLower'
  | 'toUpper'
  | 'stringReverse'
  | 'trim'
  | 'ltrim'
  | 'rtrim'
  // reference
  | 'documentId'
  | 'collectionId'
  // timestamp
  | 'timestampToUnixSeconds'
  | 'timestampToUnixMillis'
  | 'timestampToUnixMicros'
  | 'unixSecondsToTimestamp'
  | 'unixMillisToTimestamp'
  | 'unixMicrosToTimestamp'
  // type
  | 'type'
  // existence & error
  | 'exists'
  | 'isAbsent'
  | 'isError'
  // array
  | 'arrayLength'
  | 'arrayReverse'
  // map
  | 'mapKeys'
  | 'mapValues'
  | 'mapEntries'
  // vector
  | 'vectorLength';

/** A function call with exactly two operands. */
export class BinaryFunction<T extends FieldType = FieldType> extends ExpressionBase {
  readonly kind = 'binaryFunction';
  constructor(
    readonly name: BinaryFunctionName,
    readonly type: T,
    readonly left: Expression,
    readonly right: Expression,
  ) {
    super();
  }
}
export type BinaryFunctionName =
  // comparison
  | 'equal'
  | 'notEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'equalAny'
  | 'notEqualAny'
  // existence & error fallbacks
  | 'ifError'
  | 'ifAbsent'
  | 'ifNull'
  // arithmetic
  | 'add'
  | 'subtract'
  | 'multiply'
  | 'divide'
  | 'mod'
  | 'pow'
  | 'round'
  | 'trunc'
  // string
  | 'trim'
  | 'ltrim'
  | 'rtrim'
  | 'startsWith'
  | 'endsWith'
  | 'stringContains'
  | 'stringIndexOf'
  | 'stringRepeat'
  | 'substring'
  | 'like'
  // regex
  | 'regexContains'
  | 'regexMatch'
  | 'regexFind'
  | 'regexFindAll'
  // type
  | 'isType'
  // array
  | 'arrayGet'
  | 'arrayContains'
  | 'arrayContainsAll'
  | 'arrayContainsAny'
  // map
  | 'mapGet'
  | 'mapRemove'
  // timestamp (2-arg forms; the 3-arg forms carry an explicit timezone)
  | 'timestampTruncate'
  | 'timestampExtract'
  // vector
  | 'cosineDistance'
  | 'dotProduct'
  | 'euclideanDistance';

/** A function call with exactly three operands. */
export class TernaryFunction<T extends FieldType = FieldType> extends ExpressionBase {
  readonly kind = 'ternaryFunction';
  constructor(
    readonly name: TernaryFunctionName,
    readonly type: T,
    readonly first: Expression,
    readonly second: Expression,
    readonly third: Expression,
  ) {
    super();
  }
}
export type TernaryFunctionName =
  // string
  | 'stringReplaceAll'
  | 'stringReplaceOne'
  | 'substring'
  // timestamp
  | 'timestampAdd'
  | 'timestampSubtract'
  | 'timestampDiff'
  | 'timestampTruncate'
  | 'timestampExtract'
  // conditional
  | 'conditional'
  // map
  | 'mapSet';

/** A function call with two or more uniform operands. */
export class VariadicFunction<T extends FieldType = FieldType> extends ExpressionBase {
  readonly kind = 'variadicFunction';
  constructor(
    readonly name: VariadicFunctionName,
    readonly type: T,
    readonly operands: readonly [Expression, Expression, ...Expression[]],
  ) {
    super();
  }
}

/**
 * An array EXPRESSION constructor — `arrayValue([field('a'), constant(1)])`.
 * Unlike the value nodes (which hold plain values and enter expressions via
 * `constant()`), the elements here are expressions, evaluated per row
 * (probed: fields nest arbitrarily). Non-empty, mirroring `constant([])`'s
 * rejection: an empty literal has no element to infer a descriptor from.
 */
export class ArrayConstructor<T extends FieldType = FieldType> extends ExpressionBase {
  readonly kind = 'arrayConstructor';
  constructor(
    readonly type: T,
    readonly elements: readonly [Expression, ...Expression[]],
  ) {
    super();
  }
}

/** A map EXPRESSION constructor — `mapValue({ x: field('num') })`. See {@link ArrayConstructor}. */
export class MapConstructor<T extends FieldType = FieldType> extends ExpressionBase {
  readonly kind = 'mapConstructor';
  constructor(
    readonly type: T,
    readonly fields: Readonly<Record<string, Expression>>,
  ) {
    super();
  }
}
export type VariadicFunctionName =
  // logical
  | 'and'
  | 'or'
  // string
  | 'stringConcat'
  | 'xor'
  | 'logicalMaximum'
  | 'logicalMinimum'
  // array / map
  | 'arrayConcat'
  | 'mapMerge';

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

export const equal = <L extends FieldType, R extends FieldType>(
  left: Expression<L>,
  right: Expression<R> & Comparable<L, R>,
): BinaryFunction<BoolType> => new BinaryFunction('equal', bool(), left, right);

export const notEqual = <L extends FieldType, R extends FieldType>(
  left: Expression<L>,
  right: Expression<R> & Comparable<L, R>,
): BinaryFunction<BoolType> => new BinaryFunction('notEqual', bool(), left, right);

export const lessThan = <L extends FieldType, R extends FieldType>(
  left: Expression<L>,
  right: Expression<R> & Comparable<L, R>,
): BinaryFunction<BoolType> => new BinaryFunction('lessThan', bool(), left, right);

export const lessThanOrEqual = <L extends FieldType, R extends FieldType>(
  left: Expression<L>,
  right: Expression<R> & Comparable<L, R>,
): BinaryFunction<BoolType> => new BinaryFunction('lessThanOrEqual', bool(), left, right);

export const greaterThan = <L extends FieldType, R extends FieldType>(
  left: Expression<L>,
  right: Expression<R> & Comparable<L, R>,
): BinaryFunction<BoolType> => new BinaryFunction('greaterThan', bool(), left, right);

export const greaterThanOrEqual = <L extends FieldType, R extends FieldType>(
  left: Expression<L>,
  right: Expression<R> & Comparable<L, R>,
): BinaryFunction<BoolType> => new BinaryFunction('greaterThanOrEqual', bool(), left, right);

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
 * `true`), never propagated. `options` is one array-typed expression
 * (`constant([1, 5, 9])`, an array field, ...) whose elements must be
 * comparable with `value`.
 */
export const equalAny = <L extends FieldType, R extends Valued<readonly FirestoreType[]>>(
  value: Expression<L>,
  options: Expression<R> & Comparable<L, ElementsOf<R>>,
): BinaryFunction<BoolType> => new BinaryFunction('equalAny', bool(), value, options);

/** Whether `value` differs from EVERY element of the `options` array — see {@link equalAny}. */
export const notEqualAny = <L extends FieldType, R extends Valued<readonly FirestoreType[]>>(
  value: Expression<L>,
  options: Expression<R> & Comparable<L, ElementsOf<R>>,
): BinaryFunction<BoolType> => new BinaryFunction('notEqualAny', bool(), value, options);

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
  const Ops extends readonly [
    Expression<Valued<'boolean'>>,
    Expression<Valued<'boolean'>>,
    ...Expression<Valued<'boolean'>>[],
  ],
>(
  ...conditions: Ops
): VariadicFunction<PropagateNull<Ops[number]['type'], BoolType>> =>
  new VariadicFunction('and', propagateNull(conditions, bool()), conditions);

/** Logical disjunction of two or more boolean expressions (Kleene: null operands propagate). */
export const or = <
  const Ops extends readonly [
    Expression<Valued<'boolean'>>,
    Expression<Valued<'boolean'>>,
    ...Expression<Valued<'boolean'>>[],
  ],
>(
  ...conditions: Ops
): VariadicFunction<PropagateNull<Ops[number]['type'], BoolType>> =>
  new VariadicFunction('or', propagateNull(conditions, bool()), conditions);

/** Logical negation of a boolean expression (Kleene: a null operand propagates). */
export const not = <C extends Expression<Valued<'boolean'>>>(
  condition: C,
): UnaryFunction<PropagateNull<C['type'], BoolType>> =>
  new UnaryFunction('not', propagateNull([condition], bool()), condition);

/** Logical parity — true iff an odd number of operands is true (Kleene: null operands propagate). */
export const xor = <
  const Ops extends readonly [
    Expression<Valued<'boolean'>>,
    Expression<Valued<'boolean'>>,
    ...Expression<Valued<'boolean'>>[],
  ],
>(
  ...conditions: Ops
): VariadicFunction<PropagateNull<Ops[number]['type'], BoolType>> =>
  new VariadicFunction('xor', propagateNull(conditions, bool()), conditions);

/**
 * Branches on a boolean condition: the `then` value when it is `true`, the
 * `else` value otherwise — INCLUDING a null, absent, or false condition
 * (probed: not Kleene; anything non-true selects `else`). An ERROR condition
 * propagates.
 */
export const conditional = <
  C extends Expression<Valued<'boolean'>>,
  T extends Expression,
  E extends Expression,
>(
  condition: C,
  thenExpr: T,
  elseExpr: E,
): TernaryFunction<EitherType<T['type'], E['type']>> =>
  new TernaryFunction('conditional', eitherType(thenExpr, elseExpr), condition, thenExpr, elseExpr);

/**
 * The largest operand under the backend's cross-type value ordering. Null
 * and absent operands are IGNORED (probed — unlike `sort`'s null-first
 * ordering); when every operand is null/absent the result is null.
 */
export const logicalMaximum = <
  const Ops extends readonly [Expression, Expression, ...Expression[]],
>(
  ...operands: Ops
): VariadicFunction<LogicalExtreme<Ops>> =>
  new VariadicFunction('logicalMaximum', logicalExtremeType(operands), operands);

/** The smallest operand — see {@link logicalMaximum}. */
export const logicalMinimum = <
  const Ops extends readonly [Expression, Expression, ...Expression[]],
>(
  ...operands: Ops
): VariadicFunction<LogicalExtreme<Ops>> =>
  new VariadicFunction('logicalMinimum', logicalExtremeType(operands), operands);

// Operand shorthands for the factories below. These name EXPRESSION domains
// (the null special-casing itself lives once, in `Valued`).
type NumericOperand = Expression<Valued<'integer' | 'double'>>;
type StringOperand = Expression<Valued<'string'>>;

// ---- arithmetic ----
// All arithmetic returns a plain DoubleType (its 'integer' | 'double' tag is
// the honest numeric domain; per-operator integer/double refinement is a
// deferred cross-cutting item — see the expressions plan). Error edges
// (divide by zero, ln(0), sqrt of a negative) produce backend ERROR values,
// not null — observable/recoverable only through the error-channel
// functions (isError / ifError; not implemented yet).

/** A uniformly distributed random double in [0, 1), regenerated per row. */
export const rand = (): NullaryFunction<DoubleType> => new NullaryFunction('rand', double());

/** Numeric addition. */
export const add = <L extends NumericOperand, R extends NumericOperand>(
  left: L,
  right: R,
): BinaryFunction<PropagateNull<L['type'] | R['type'], DoubleType>> =>
  new BinaryFunction('add', propagateNull([left, right], double()), left, right);

/** Numeric subtraction (`left - right`). */
export const subtract = <L extends NumericOperand, R extends NumericOperand>(
  left: L,
  right: R,
): BinaryFunction<PropagateNull<L['type'] | R['type'], DoubleType>> =>
  new BinaryFunction('subtract', propagateNull([left, right], double()), left, right);

/** Numeric multiplication. */
export const multiply = <L extends NumericOperand, R extends NumericOperand>(
  left: L,
  right: R,
): BinaryFunction<PropagateNull<L['type'] | R['type'], DoubleType>> =>
  new BinaryFunction('multiply', propagateNull([left, right], double()), left, right);

/** Numeric division (`left / right`); a zero divisor is a backend ERROR value. */
export const divide = <L extends NumericOperand, R extends NumericOperand>(
  left: L,
  right: R,
): BinaryFunction<PropagateNull<L['type'] | R['type'], DoubleType>> =>
  new BinaryFunction('divide', propagateNull([left, right], double()), left, right);

/** Modulo (`left % right`). */
export const mod = <L extends NumericOperand, R extends NumericOperand>(
  left: L,
  right: R,
): BinaryFunction<PropagateNull<L['type'] | R['type'], DoubleType>> =>
  new BinaryFunction('mod', propagateNull([left, right], double()), left, right);

/** Exponentiation (`base ** exponent`). */
export const pow = <L extends NumericOperand, R extends NumericOperand>(
  base: L,
  exponent: R,
): BinaryFunction<PropagateNull<L['type'] | R['type'], DoubleType>> =>
  new BinaryFunction('pow', propagateNull([base, exponent], double()), base, exponent);

/** Absolute value. */
export const abs = <Op extends NumericOperand>(
  expression: Op,
): UnaryFunction<PropagateNull<Op['type'], DoubleType>> =>
  new UnaryFunction('abs', propagateNull([expression], double()), expression);

/** Rounds up to the nearest whole number. */
export const ceil = <Op extends NumericOperand>(
  expression: Op,
): UnaryFunction<PropagateNull<Op['type'], DoubleType>> =>
  new UnaryFunction('ceil', propagateNull([expression], double()), expression);

/** Rounds down to the nearest whole number. */
export const floor = <Op extends NumericOperand>(
  expression: Op,
): UnaryFunction<PropagateNull<Op['type'], DoubleType>> =>
  new UnaryFunction('floor', propagateNull([expression], double()), expression);

/** Square root; a negative operand is a backend ERROR value. */
export const sqrt = <Op extends NumericOperand>(
  expression: Op,
): UnaryFunction<PropagateNull<Op['type'], DoubleType>> =>
  new UnaryFunction('sqrt', propagateNull([expression], double()), expression);

/** The exponential function (e ** operand). */
export const exp = <Op extends NumericOperand>(
  expression: Op,
): UnaryFunction<PropagateNull<Op['type'], DoubleType>> =>
  new UnaryFunction('exp', propagateNull([expression], double()), expression);

/** Natural logarithm; a non-positive operand is a backend ERROR value. */
export const ln = <Op extends NumericOperand>(
  expression: Op,
): UnaryFunction<PropagateNull<Op['type'], DoubleType>> =>
  new UnaryFunction('ln', propagateNull([expression], double()), expression);

/** Base-10 logarithm; a non-positive operand is a backend ERROR value. */
export const log10 = <Op extends NumericOperand>(
  expression: Op,
): UnaryFunction<PropagateNull<Op['type'], DoubleType>> =>
  new UnaryFunction('log10', propagateNull([expression], double()), expression);

/** Rounds to the nearest whole number, or to `decimalPlaces` decimal places. */
export function round<Op extends NumericOperand>(
  expression: Op,
): UnaryFunction<PropagateNull<Op['type'], DoubleType>>;
export function round<Op extends NumericOperand, P extends NumericOperand>(
  expression: Op,
  decimalPlaces: P,
): BinaryFunction<PropagateNull<Op['type'] | P['type'], DoubleType>>;
export function round(
  expression: Expression,
  decimalPlaces?: Expression,
): UnaryFunction | BinaryFunction {
  return decimalPlaces === undefined
    ? new UnaryFunction('round', propagateNull([expression], double()), expression)
    : new BinaryFunction(
        'round',
        propagateNull([expression, decimalPlaces], double()),
        expression,
        decimalPlaces,
      );
}

/** Truncates toward zero, to a whole number or to `decimalPlaces` decimal places. */
export function trunc<Op extends NumericOperand>(
  expression: Op,
): UnaryFunction<PropagateNull<Op['type'], DoubleType>>;
export function trunc<Op extends NumericOperand, P extends NumericOperand>(
  expression: Op,
  decimalPlaces: P,
): BinaryFunction<PropagateNull<Op['type'] | P['type'], DoubleType>>;
export function trunc(
  expression: Expression,
  decimalPlaces?: Expression,
): UnaryFunction | BinaryFunction {
  return decimalPlaces === undefined
    ? new UnaryFunction('trunc', propagateNull([expression], double()), expression)
    : new BinaryFunction(
        'trunc',
        propagateNull([expression, decimalPlaces], double()),
        expression,
        decimalPlaces,
      );
}

// ---- string ----

/** The number of characters (Unicode code points) in a string. */
export const charLength = <Op extends StringOperand>(
  expression: Op,
): UnaryFunction<PropagateNull<Op['type'], Int64Type>> =>
  new UnaryFunction('charLength', propagateNull([expression], int64()), expression);

/** The number of bytes in a string's UTF-8 encoding. */
export const byteLength = <Op extends StringOperand>(
  expression: Op,
): UnaryFunction<PropagateNull<Op['type'], Int64Type>> =>
  new UnaryFunction('byteLength', propagateNull([expression], int64()), expression);

/** Lowercases a string. */
export const toLower = <Op extends StringOperand>(
  expression: Op,
): UnaryFunction<PropagateNull<Op['type'], StringType>> =>
  new UnaryFunction('toLower', propagateNull([expression], string()), expression);

/** Uppercases a string. */
export const toUpper = <Op extends StringOperand>(
  expression: Op,
): UnaryFunction<PropagateNull<Op['type'], StringType>> =>
  new UnaryFunction('toUpper', propagateNull([expression], string()), expression);

/** Reverses a string. */
export const stringReverse = <Op extends StringOperand>(
  expression: Op,
): UnaryFunction<PropagateNull<Op['type'], StringType>> =>
  new UnaryFunction('stringReverse', propagateNull([expression], string()), expression);

/** Trims whitespace from both ends, or every character of `charactersToTrim`. */
export function trim<Op extends StringOperand>(
  expression: Op,
): UnaryFunction<PropagateNull<Op['type'], StringType>>;
export function trim<Op extends StringOperand, C extends StringOperand>(
  expression: Op,
  charactersToTrim: C,
): BinaryFunction<PropagateNull<Op['type'] | C['type'], StringType>>;
export function trim(
  expression: Expression,
  charactersToTrim?: Expression,
): UnaryFunction | BinaryFunction {
  return charactersToTrim === undefined
    ? new UnaryFunction('trim', propagateNull([expression], string()), expression)
    : new BinaryFunction(
        'trim',
        propagateNull([expression, charactersToTrim], string()),
        expression,
        charactersToTrim,
      );
}

/** Trims the leading end — see {@link trim}. */
export function ltrim<Op extends StringOperand>(
  expression: Op,
): UnaryFunction<PropagateNull<Op['type'], StringType>>;
export function ltrim<Op extends StringOperand, C extends StringOperand>(
  expression: Op,
  charactersToTrim: C,
): BinaryFunction<PropagateNull<Op['type'] | C['type'], StringType>>;
export function ltrim(
  expression: Expression,
  charactersToTrim?: Expression,
): UnaryFunction | BinaryFunction {
  return charactersToTrim === undefined
    ? new UnaryFunction('ltrim', propagateNull([expression], string()), expression)
    : new BinaryFunction(
        'ltrim',
        propagateNull([expression, charactersToTrim], string()),
        expression,
        charactersToTrim,
      );
}

/** Trims the trailing end — see {@link trim}. */
export function rtrim<Op extends StringOperand>(
  expression: Op,
): UnaryFunction<PropagateNull<Op['type'], StringType>>;
export function rtrim<Op extends StringOperand, C extends StringOperand>(
  expression: Op,
  charactersToTrim: C,
): BinaryFunction<PropagateNull<Op['type'] | C['type'], StringType>>;
export function rtrim(
  expression: Expression,
  charactersToTrim?: Expression,
): UnaryFunction | BinaryFunction {
  return charactersToTrim === undefined
    ? new UnaryFunction('rtrim', propagateNull([expression], string()), expression)
    : new BinaryFunction(
        'rtrim',
        propagateNull([expression, charactersToTrim], string()),
        expression,
        charactersToTrim,
      );
}

// The string predicates PROPAGATE null (probed: startsWith(null, 'x') is
// null), unlike the comparison operators, which are total — hence the
// PropagateNull in their return types.

/** Whether `value` starts with `prefix`. */
export const startsWith = <L extends StringOperand, R extends StringOperand>(
  value: L,
  prefix: R,
): BinaryFunction<PropagateNull<L['type'] | R['type'], BoolType>> =>
  new BinaryFunction('startsWith', propagateNull([value, prefix], bool()), value, prefix);

/** Whether `value` ends with `suffix`. */
export const endsWith = <L extends StringOperand, R extends StringOperand>(
  value: L,
  suffix: R,
): BinaryFunction<PropagateNull<L['type'] | R['type'], BoolType>> =>
  new BinaryFunction('endsWith', propagateNull([value, suffix], bool()), value, suffix);

/** Whether `value` contains `substring`. */
export const stringContains = <L extends StringOperand, R extends StringOperand>(
  value: L,
  substring: R,
): BinaryFunction<PropagateNull<L['type'] | R['type'], BoolType>> =>
  new BinaryFunction('stringContains', propagateNull([value, substring], bool()), value, substring);

/** Concatenates two or more strings. */
export const stringConcat = <
  const Ops extends readonly [StringOperand, StringOperand, ...StringOperand[]],
>(
  ...strings: Ops
): VariadicFunction<PropagateNull<Ops[number]['type'], StringType>> =>
  new VariadicFunction('stringConcat', propagateNull(strings, string()), strings);

/** The 0-based index of the first occurrence of `substring`, or -1 if absent. */
export const stringIndexOf = <L extends StringOperand, R extends StringOperand>(
  value: L,
  substring: R,
): BinaryFunction<PropagateNull<L['type'] | R['type'], Int64Type>> =>
  new BinaryFunction('stringIndexOf', propagateNull([value, substring], int64()), value, substring);

/** Repeats a string `count` times. */
export const stringRepeat = <L extends StringOperand, R extends NumericOperand>(
  value: L,
  count: R,
): BinaryFunction<PropagateNull<L['type'] | R['type'], StringType>> =>
  new BinaryFunction('stringRepeat', propagateNull([value, count], string()), value, count);

/** Replaces every occurrence of `find` with `replacement`. */
export const stringReplaceAll = <
  L extends StringOperand,
  M extends StringOperand,
  R extends StringOperand,
>(
  value: L,
  find: M,
  replacement: R,
): TernaryFunction<PropagateNull<L['type'] | M['type'] | R['type'], StringType>> =>
  new TernaryFunction(
    'stringReplaceAll',
    propagateNull([value, find, replacement], string()),
    value,
    find,
    replacement,
  );

/** Replaces the first occurrence of `find` with `replacement`. */
export const stringReplaceOne = <
  L extends StringOperand,
  M extends StringOperand,
  R extends StringOperand,
>(
  value: L,
  find: M,
  replacement: R,
): TernaryFunction<PropagateNull<L['type'] | M['type'] | R['type'], StringType>> =>
  new TernaryFunction(
    'stringReplaceOne',
    propagateNull([value, find, replacement], string()),
    value,
    find,
    replacement,
  );

/**
 * The substring from the 0-based `position`, spanning `length` characters or
 * (omitted) to the end of the string.
 */
export function substring<Op extends StringOperand, P extends NumericOperand>(
  value: Op,
  position: P,
): BinaryFunction<PropagateNull<Op['type'] | P['type'], StringType>>;
export function substring<
  Op extends StringOperand,
  P extends NumericOperand,
  Len extends NumericOperand,
>(
  value: Op,
  position: P,
  length: Len,
): TernaryFunction<PropagateNull<Op['type'] | P['type'] | Len['type'], StringType>>;
export function substring(
  value: Expression,
  position: Expression,
  length?: Expression,
): BinaryFunction | TernaryFunction {
  return length === undefined
    ? new BinaryFunction('substring', propagateNull([value, position], string()), value, position)
    : new TernaryFunction(
        'substring',
        propagateNull([value, position, length], string()),
        value,
        position,
        length,
      );
}

/** SQL LIKE match (`%` any sequence, `_` any single character). */
export const like = <L extends StringOperand, R extends StringOperand>(
  value: L,
  pattern: R,
): BinaryFunction<PropagateNull<L['type'] | R['type'], BoolType>> =>
  new BinaryFunction('like', propagateNull([value, pattern], bool()), value, pattern);

// ---- regex ----
// An invalid pattern is a backend ERROR value (see the error-channel note
// on the arithmetic section).

/** Whether `value` contains a match of the RE2 `pattern`. */
export const regexContains = <L extends StringOperand, R extends StringOperand>(
  value: L,
  pattern: R,
): BinaryFunction<PropagateNull<L['type'] | R['type'], BoolType>> =>
  new BinaryFunction('regexContains', propagateNull([value, pattern], bool()), value, pattern);

/** Whether `value` ENTIRELY matches the RE2 `pattern`. */
export const regexMatch = <L extends StringOperand, R extends StringOperand>(
  value: L,
  pattern: R,
): BinaryFunction<PropagateNull<L['type'] | R['type'], BoolType>> =>
  new BinaryFunction('regexMatch', propagateNull([value, pattern], bool()), value, pattern);

/**
 * The first match of the RE2 `pattern`, or `null` when there is none — the
 * result is ALWAYS nullable (probed), independent of operand nullability.
 */
export const regexFind = <L extends StringOperand, R extends StringOperand>(
  value: L,
  pattern: R,
): BinaryFunction<UnionType<[StringType, NullType]>> =>
  new BinaryFunction('regexFind', nullable(string()), value, pattern);

/** Every match of the RE2 `pattern` (empty array when there is none). */
export const regexFindAll = <L extends StringOperand, R extends StringOperand>(
  value: L,
  pattern: R,
): BinaryFunction<PropagateNull<L['type'] | R['type'], ArrayType<StringType>>> =>
  new BinaryFunction(
    'regexFindAll',
    propagateNull([value, pattern], array(string())),
    value,
    pattern,
  );

// ---- reference ----

/** A reference-domain operand: a `docRef(...)` field or the reserved `'__name__'`. */
type ReferenceOperand = Expression<Valued<'reference'>>;

/** The document id (the path's last segment) of a reference. */
export const documentId = <Op extends ReferenceOperand>(
  reference: Op,
): UnaryFunction<PropagateNull<Op['type'], StringType>> =>
  new UnaryFunction('documentId', propagateNull([reference], string()), reference);

/** The id of the collection containing the referenced document. */
export const collectionId = <Op extends ReferenceOperand>(
  reference: Op,
): UnaryFunction<PropagateNull<Op['type'], StringType>> =>
  new UnaryFunction('collectionId', propagateNull([reference], string()), reference);

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
export const type = <Op extends Expression>(
  value: Op,
): UnaryFunction<PropagateAbsence<Op['type'], LiteralType<FirestoreTypeName[]>>> =>
  new UnaryFunction('type', propagateAbsence([value], typeNameLiteral()), value);

/**
 * Whether the operand's value is of the named backend type. The name must be
 * a compile-time literal (the backend requires a constant — probed), lifted
 * into a constant operand wire-faithfully. Type-observing like {@link type}:
 * only absence propagates.
 */
export const isType = <Op extends Expression>(
  value: Op,
  typeName: FirestoreTypeName,
): BinaryFunction<PropagateAbsence<Op['type'], BoolType>> =>
  new BinaryFunction('isType', propagateAbsence([value], bool()), value, Constant.of(typeName));

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

/** Builds an array expression from element expressions — see {@link ArrayConstructor}. */
export const arrayValue = <const Els extends readonly [Expression, ...Expression[]]>(
  elements: Els,
): ArrayConstructor<ArrayType<ElementUnion<Els>>> =>
  new ArrayConstructor(array(elementUnionType(elements)), elements);

/** The number of elements. */
export const arrayLength = <Op extends ArrayOperand>(
  value: Op,
): UnaryFunction<PropagateNull<Op['type'], Int64Type>> =>
  new UnaryFunction('arrayLength', propagateNull([value], int64()), value);

/** The array reversed. */
export const arrayReverse = <Op extends ArrayOperand>(
  value: Op,
): UnaryFunction<PropagateNull<Op['type'], StripNull<Op['type']>>> =>
  new UnaryFunction('arrayReverse', propagateNull([value], stripNullOf(value)), value);

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
export const arrayGet = <Arr extends ArrayOperand, Idx extends NumericOperand>(
  value: Arr,
  index: Idx,
): BinaryFunction<UnionType<[ElementsOf<StripNull<Arr['type']>>, NullType]>> =>
  new BinaryFunction('arrayGet', nullable(elementTypeOf(value)), value, index);

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
export const arrayContains = <Arr extends ArrayOperand, El extends FieldType>(
  value: Arr,
  element: Expression<El> & Comparable<ElementsOf<StripNull<Arr['type']>>, El>,
): BinaryFunction<PropagateNull<Arr['type'], BoolType>> =>
  new BinaryFunction('arrayContains', propagateNull([value], bool()), value, element);

/** Whether the array contains EVERY element of the options array. */
export const arrayContainsAll = <Arr extends ArrayOperand, Opts extends ArrayOperand>(
  value: Arr,
  options: Opts &
    Comparable<ElementsOf<StripNull<Arr['type']>>, ElementsOf<StripNull<Opts['type']>>>,
): BinaryFunction<PropagateNull<Arr['type'] | Opts['type'], BoolType>> =>
  new BinaryFunction('arrayContainsAll', propagateNull([value, options], bool()), value, options);

/** Whether the array contains ANY element of the options array. */
export const arrayContainsAny = <Arr extends ArrayOperand, Opts extends ArrayOperand>(
  value: Arr,
  options: Opts &
    Comparable<ElementsOf<StripNull<Arr['type']>>, ElementsOf<StripNull<Opts['type']>>>,
): BinaryFunction<PropagateNull<Arr['type'] | Opts['type'], BoolType>> =>
  new BinaryFunction('arrayContainsAny', propagateNull([value, options], bool()), value, options);

/** The concatenation of two or more arrays. */
export const arrayConcat = <
  const Ops extends readonly [ArrayOperand, ArrayOperand, ...ArrayOperand[]],
>(
  ...operands: Ops
): VariadicFunction<PropagateNull<Ops[number]['type'], ArrayType<ConcatElementUnion<Ops>>>> =>
  new VariadicFunction(
    'arrayConcat',
    propagateNull(operands, array(concatElementUnionType(operands))),
    operands,
  );

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
// "map_set keys must be constants/literals"), lifted like `isType`'s type
// name. `mapGet`'s key MAY be dynamic on the backend, but the factory takes
// a literal so the result subschema is key-aware; a dynamic-key overload is
// deferred.

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
export const mapGet = <M extends MapOperand, K extends MapKeysOf<M['type']>>(
  value: M,
  key: K,
): BinaryFunction<PropagateNull<M['type'], MapValueType<FieldsOf<StripNull<M['type']>>[K]>>> =>
  new BinaryFunction(
    'mapGet',
    propagateNull([value], mapValueTypeOf(value, key)),
    value,
    Constant.of(key),
  );

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

/** Builds a map expression from field-value expressions — see {@link MapConstructor}. */
export const mapValue = <const F extends Readonly<Record<string, Expression>>>(
  fields: F & WithoutDottedKeys<F>,
): MapConstructor<MapType<{ [K in keyof F & string]: WithoutOptional<F[K]['type']> }>> =>
  new MapConstructor(mapDescriptor(mapConstructorFields(fields)), fields);

/** Runtime counterpart of `mapValue`'s fields record (same bridge shape as `propagateNull`). */
function mapConstructorFields<F extends Readonly<Record<string, Expression>>>(
  fields: F,
): { [K in keyof F & string]: WithoutOptional<F[K]['type']> };
function mapConstructorFields(fields: Readonly<Record<string, Expression>>): FieldsRecord {
  return Object.fromEntries(Object.entries(fields).map(([k, e]) => [k, withoutOptional(e.type)]));
}

/** The map's keys, as a string array. */
export const mapKeys = <M extends MapOperand>(
  value: M,
): UnaryFunction<PropagateNull<M['type'], ArrayType<StringType>>> =>
  new UnaryFunction('mapKeys', propagateNull([value], array(string())), value);

/** The map's values, as an array of the deduped field-type union. */
export const mapValues = <M extends MapOperand>(
  value: M,
): UnaryFunction<
  PropagateNull<M['type'], ArrayType<MapFieldUnion<FieldsOf<StripNull<M['type']>>>>>
> => new UnaryFunction('mapValues', propagateNull([value], array(mapFieldUnionType(value))), value);

/** The map's entries, as an array of `{ k, v }` maps (probed shape). */
export const mapEntries = <M extends MapOperand>(
  value: M,
): UnaryFunction<
  PropagateNull<
    M['type'],
    ArrayType<MapType<{ k: StringType; v: MapFieldUnion<FieldsOf<StripNull<M['type']>>> }>>
  >
> =>
  new UnaryFunction(
    'mapEntries',
    propagateNull([value], array(map({ k: string(), v: mapFieldUnionType(value) }))),
    value,
  );

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
 * The key must be a literal constant (backend-validated), lifted like
 * `isType`'s type name.
 */
export const mapSet = <M extends MapOperand, K extends string, V extends Expression>(
  value: M,
  key: K & UndottedKey<K>,
  entry: V,
): TernaryFunction<
  PropagateNull<
    M['type'],
    MapType<
      SetField<FieldsOf<StripNull<M['type']>>, K & UndottedKey<K>, WithoutOptional<V['type']>>
    >
  >
> =>
  new TernaryFunction(
    'mapSet',
    propagateNull([value], mapDescriptor(setField(value, key, entry))),
    value,
    Constant.of(key),
    entry,
  );

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
export const mapRemove = <M extends MapOperand, K extends string>(
  value: M,
  key: K & UndottedKey<K>,
): BinaryFunction<
  PropagateNull<M['type'], MapType<Omit<FieldsOf<StripNull<M['type']>>, K & UndottedKey<K>>>>
> =>
  new BinaryFunction(
    'mapRemove',
    propagateNull([value], mapDescriptor(removeField(value, key))),
    value,
    Constant.of(key),
  );

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

/** The shallow merge of two or more maps — a later operand's key wins (probed). */
export const mapMerge = <const Ops extends readonly [MapOperand, MapOperand, ...MapOperand[]]>(
  ...operands: Ops
): VariadicFunction<PropagateNull<Ops[number]['type'], MapType<MergeFields<Ops>>>> =>
  new VariadicFunction(
    'mapMerge',
    propagateNull(operands, mapDescriptor(mergeFields(operands))),
    operands,
  );

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
export const exists = <F extends Field>(target: F): UnaryFunction<BoolType> =>
  new UnaryFunction('exists', bool(), target);

/** Whether the field is absent from the document — the negation of {@link exists}, with the same field-reference-only constraint. */
export const isAbsent = <F extends Field>(target: F): UnaryFunction<BoolType> =>
  new UnaryFunction('isAbsent', bool(), target);

/** Whether the operand evaluates to a backend ERROR value (total: null/absent are `false`). */
export const isError = <Op extends Expression>(value: Op): UnaryFunction<BoolType> =>
  new UnaryFunction('isError', bool(), value);

/**
 * The `try` value, or the `catch` value if `try` evaluates to a backend
 * ERROR. Null and absent pass through the `try` side untouched (probed) —
 * they are values, not errors.
 */
export const ifError = <T extends Expression, C extends Expression>(
  tryExpr: T,
  catchExpr: C,
): BinaryFunction<PropagateAbsence<T['type'], EitherType<T['type'], C['type']>>> =>
  new BinaryFunction(
    'ifError',
    propagateAbsence([tryExpr], eitherType(tryExpr, catchExpr)),
    tryExpr,
    catchExpr,
  );

/**
 * The value, or the fallback when the value is ABSENT. A present null passes
 * through (probed) — absence is the only trigger. An ERROR propagates.
 */
export const ifAbsent = <T extends Expression, C extends Expression>(
  value: T,
  fallback: C,
): BinaryFunction<EitherType<T['type'], C['type']>> =>
  new BinaryFunction('ifAbsent', eitherType(value, fallback), value, fallback);

/**
 * The value, or the fallback when the value is null OR absent (probed:
 * absence merges into null here, unlike {@link ifAbsent}). The pass-through
 * side is null-stripped in the return descriptor — a value that got past
 * the check cannot be null. An ERROR propagates.
 */
export const ifNull = <T extends Expression, C extends Expression>(
  value: T,
  fallback: C,
): BinaryFunction<EitherType<StripNull<T['type']>, C['type']>> =>
  new BinaryFunction('ifNull', ifNullType(value, fallback), value, fallback);

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
// ERROR value), so the factories take literal parameters and lift them via
// `Constant.of`, like `isType`. Out-of-range results and invalid timezone
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
export const currentTimestamp = (): NullaryFunction<TimestampType> =>
  new NullaryFunction('currentTimestamp', timestamp());

/** The operand as a unix epoch in seconds (fractions truncated toward zero). */
export const timestampToUnixSeconds = <Op extends TimestampOperand>(
  value: Op,
): UnaryFunction<PropagateNull<Op['type'], Int64Type>> =>
  new UnaryFunction('timestampToUnixSeconds', propagateNull([value], int64()), value);

/** The operand as a unix epoch in milliseconds. */
export const timestampToUnixMillis = <Op extends TimestampOperand>(
  value: Op,
): UnaryFunction<PropagateNull<Op['type'], Int64Type>> =>
  new UnaryFunction('timestampToUnixMillis', propagateNull([value], int64()), value);

/** The operand as a unix epoch in microseconds. */
export const timestampToUnixMicros = <Op extends TimestampOperand>(
  value: Op,
): UnaryFunction<PropagateNull<Op['type'], Int64Type>> =>
  new UnaryFunction('timestampToUnixMicros', propagateNull([value], int64()), value);

/** The timestamp at the given unix epoch in seconds (integers only — a fractional value is a backend error). */
export const unixSecondsToTimestamp = <Op extends NumericOperand>(
  value: Op,
): UnaryFunction<PropagateNull<Op['type'], TimestampType>> =>
  new UnaryFunction('unixSecondsToTimestamp', propagateNull([value], timestamp()), value);

/** The timestamp at the given unix epoch in milliseconds (integers only). */
export const unixMillisToTimestamp = <Op extends NumericOperand>(
  value: Op,
): UnaryFunction<PropagateNull<Op['type'], TimestampType>> =>
  new UnaryFunction('unixMillisToTimestamp', propagateNull([value], timestamp()), value);

/** The timestamp at the given unix epoch in microseconds (integers only). */
export const unixMicrosToTimestamp = <Op extends NumericOperand>(
  value: Op,
): UnaryFunction<PropagateNull<Op['type'], TimestampType>> =>
  new UnaryFunction('unixMicrosToTimestamp', propagateNull([value], timestamp()), value);

/** The timestamp moved forward by `amount` `unit`s (out-of-range results are backend ERROR values). */
export const timestampAdd = <Ts extends TimestampOperand, Amount extends NumericOperand>(
  value: Ts,
  unit: TimeUnit,
  amount: Amount,
): TernaryFunction<PropagateNull<Ts['type'] | Amount['type'], TimestampType>> =>
  new TernaryFunction(
    'timestampAdd',
    propagateNull([value, amount], timestamp()),
    value,
    Constant.of(unit),
    amount,
  );

/** The timestamp moved backward by `amount` `unit`s. */
export const timestampSubtract = <Ts extends TimestampOperand, Amount extends NumericOperand>(
  value: Ts,
  unit: TimeUnit,
  amount: Amount,
): TernaryFunction<PropagateNull<Ts['type'] | Amount['type'], TimestampType>> =>
  new TernaryFunction(
    'timestampSubtract',
    propagateNull([value, amount], timestamp()),
    value,
    Constant.of(unit),
    amount,
  );

/**
 * `end - start` in whole `unit`s, truncated toward zero (probed: 2.6 days →
 * `2`; negative when `end` precedes `start`). Units only — calendar
 * granularities (`'week'`, `'month'`, ...) are rejected by the backend.
 */
export const timestampDiff = <End extends TimestampOperand, Start extends TimestampOperand>(
  end: End,
  start: Start,
  unit: TimeUnit,
): TernaryFunction<PropagateNull<End['type'] | Start['type'], Int64Type>> =>
  new TernaryFunction(
    'timestampDiff',
    propagateNull([end, start], int64()),
    end,
    start,
    Constant.of(unit),
  );

/**
 * The timestamp truncated down to the given granularity, in the given IANA
 * timezone (default UTC). An invalid timezone VALUE is a backend ERROR value.
 */
export function timestampTruncate<Ts extends TimestampOperand>(
  value: Ts,
  granularity: TimeGranularity,
): BinaryFunction<PropagateNull<Ts['type'], TimestampType>>;
export function timestampTruncate<Ts extends TimestampOperand>(
  value: Ts,
  granularity: TimeGranularity,
  timezone: string,
): TernaryFunction<PropagateNull<Ts['type'], TimestampType>>;
export function timestampTruncate(
  value: Expression,
  granularity: TimeGranularity,
  timezone?: string,
): BinaryFunction | TernaryFunction {
  const type = propagateNull([value], timestamp());
  return timezone === undefined
    ? new BinaryFunction('timestampTruncate', type, value, Constant.of(granularity))
    : new TernaryFunction(
        'timestampTruncate',
        type,
        value,
        Constant.of(granularity),
        Constant.of(timezone),
      );
}

/**
 * The given part of the timestamp as an integer, in the given IANA timezone
 * (default UTC). `'dayofweek'` is 1-based from Sunday (probed: a Friday →
 * `6`).
 */
export function timestampExtract<Ts extends TimestampOperand>(
  value: Ts,
  part: TimePart,
): BinaryFunction<PropagateNull<Ts['type'], Int64Type>>;
export function timestampExtract<Ts extends TimestampOperand>(
  value: Ts,
  part: TimePart,
  timezone: string,
): TernaryFunction<PropagateNull<Ts['type'], Int64Type>>;
export function timestampExtract(
  value: Expression,
  part: TimePart,
  timezone?: string,
): BinaryFunction | TernaryFunction {
  const type = propagateNull([value], int64());
  return timezone === undefined
    ? new BinaryFunction('timestampExtract', type, value, Constant.of(part))
    : new TernaryFunction(
        'timestampExtract',
        type,
        value,
        Constant.of(part),
        Constant.of(timezone),
      );
}

// ---- vector ----
// Distance functions over mismatched dimensions are backend ERROR values.

/** A vector-domain operand: a `vector()` field or a `vectorValue(...)` node. */
type VectorOperand = Expression<Valued<'vector'>>;

/** The cosine distance between two vectors. */
export const cosineDistance = <L extends VectorOperand, R extends VectorOperand>(
  left: L,
  right: R,
): BinaryFunction<PropagateNull<L['type'] | R['type'], DoubleType>> =>
  new BinaryFunction('cosineDistance', propagateNull([left, right], double()), left, right);

/** The dot product of two vectors. */
export const dotProduct = <L extends VectorOperand, R extends VectorOperand>(
  left: L,
  right: R,
): BinaryFunction<PropagateNull<L['type'] | R['type'], DoubleType>> =>
  new BinaryFunction('dotProduct', propagateNull([left, right], double()), left, right);

/** The euclidean distance between two vectors. */
export const euclideanDistance = <L extends VectorOperand, R extends VectorOperand>(
  left: L,
  right: R,
): BinaryFunction<PropagateNull<L['type'] | R['type'], DoubleType>> =>
  new BinaryFunction('euclideanDistance', propagateNull([left, right], double()), left, right);

/** The number of dimensions of a vector. */
export const vectorLength = <Op extends VectorOperand>(
  vector: Op,
): UnaryFunction<PropagateNull<Op['type'], Int64Type>> =>
  new UnaryFunction('vectorLength', propagateNull([vector], int64()), vector);
