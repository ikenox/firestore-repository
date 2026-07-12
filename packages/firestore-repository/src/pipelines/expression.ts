import {
  array,
  type ArrayType,
  bool,
  type BoolType,
  bytes,
  type BytesType,
  double,
  type DoubleType,
  type FieldType,
  type FirestoreType,
  geoPoint,
  type GeoPointType,
  int64,
  type Int64Type,
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
export type Expression<T extends FieldType = FieldType> =
  | Field<T>
  | Constant<T>
  | GeoPointValue
  | VectorValue
  | NullaryFunction<T>
  | UnaryFunction<T>
  | BinaryFunction<T>
  | VariadicFunction<T>;

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
 * A geopoint value. A dedicated node (not a `Constant`): a geopoint has no JS
 * representation of its own — a plain `{ latitude, longitude }` object is
 * always a **map** constant — so the coordinates are explicit and executors
 * translate by `kind` with no payload ambiguity.
 */
export class GeoPointValue extends ExpressionBase {
  readonly kind = 'geoPointValue';
  readonly type: GeoPointType = geoPoint();
  constructor(
    readonly latitude: number,
    readonly longitude: number,
  ) {
    super();
  }
}

/**
 * A vector value. A dedicated node (not a `Constant`): a `number[]` is always
 * an **array** constant, so vectors are constructed explicitly.
 */
export class VectorValue extends ExpressionBase {
  readonly kind = 'vectorValue';
  readonly type: VectorType = vector();
  readonly values: readonly number[];
  constructor(values: readonly number[]) {
    super();
    this.values = [...values];
  }
}

/**
 * The value domain `constant()` accepts — everything with an unambiguous
 * plain-JS representation: scalars, arrays and plain-object maps,
 * recursively. Firestore types WITHOUT their own JS representation get
 * explicit constructors instead — a plain object is always a **map** constant
 * (use {@link geoPointValue} for geopoints) and a `number[]` is always an
 * **array** constant (use {@link vectorValue} for vectors). Document refs
 * need collection context and stay deferred.
 */
export type ConstantValue = ConstantScalar | ConstantLeafNode | ConstantArray | ConstantMap;
export type ConstantScalar = string | number | boolean | null | Date | Uint8Array;
/**
 * Value nodes usable as composite leaves: Firestore values may hold geopoints
 * and vectors at any depth, and since those have no plain-JS representation of
 * their own, their explicit nodes stand in —
 * `constant({ spot: geoPointValue(1, 3) })`.
 */
export type ConstantLeafNode = GeoPointValue | VectorValue;
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
  if (value instanceof GeoPointValue || value instanceof VectorValue) {
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
export type NullaryFunctionName = 'rand';

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
export type UnaryFunctionName =
  | 'not'
  | 'abs'
  | 'ceil'
  | 'floor'
  | 'round'
  | 'trunc'
  | 'sqrt'
  | 'exp'
  | 'ln'
  | 'log10'
  | 'charLength'
  | 'byteLength'
  | 'toLower'
  | 'toUpper'
  | 'stringReverse'
  | 'trim'
  | 'ltrim'
  | 'rtrim';

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
  | 'equal'
  | 'notEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'add'
  | 'subtract'
  | 'multiply'
  | 'divide'
  | 'mod'
  | 'pow'
  | 'round'
  | 'trunc'
  | 'trim'
  | 'ltrim'
  | 'rtrim'
  | 'startsWith'
  | 'endsWith'
  | 'stringContains';

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
export type VariadicFunctionName = 'and' | 'or' | 'stringConcat';

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

/**
 * Null propagation for a function's RETURN descriptor: `T` when no operand
 * can be null, `nullable(T)` when one can. An operand "can be null" when its
 * tags include `'null'` or it is `& Optional` — an absent operand flows
 * through functions as `null` (probed), so optionality implies a possibly-null
 * result even though presence stays off the tag axis.
 *
 * The logical operators need this (probed — Kleene three-valued logic:
 * `and(true, null)` is `null` while `and(false, null)` is `false`, `or` and
 * `not` mirror it), and most value functions in later slices will too. The
 * comparison operators do NOT: they are total (never null).
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

// Operand shorthands for the factories below. These name EXPRESSION domains
// (the null special-casing itself lives once, in `Valued`).
type NumericOperand = Expression<Valued<'integer' | 'double'>>;
type StringOperand = Expression<Valued<'string'>>;

// ---- arithmetic ----
// All arithmetic returns a plain DoubleType (its 'integer' | 'double' tag is
// the honest numeric domain; per-operator integer/double refinement is a
// deferred cross-cutting item — see the expressions plan). Error edges
// (divide by zero, ln(0), sqrt of a negative) produce backend ERROR values,
// not null — the error channel is handled by isError/ifError (slice 5).

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
