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
  geoPoint,
  type GeoPointType,
  map,
  type MapType,
  nullType,
  type NullType,
  string,
  type StringType,
  timestamp,
  type TimestampType,
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
export type ConstantValue = ConstantScalar | ConstantArray | ConstantMap;
export type ConstantScalar = string | number | boolean | null | Date | Uint8Array;
/**
 * Non-empty (an empty literal has no element to infer a descriptor from) and
 * non-nested (Firestore forbids arrays directly inside arrays).
 */
export type ConstantArray = readonly [ConstantElement, ...ConstantElement[]];
type ConstantElement = ConstantScalar | ConstantMap;
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
        : V extends string
          ? StringType
          : V extends number
            ? DoubleType
            : V extends boolean
              ? BoolType
              : V extends ConstantArray
                ? IsUnion<ConstantTypeOf<V[number]>> extends true
                  ? never // heterogeneous elements — see HomogeneousArrays
                  : ArrayType<ConstantTypeOf<V[number]>, [], []>
                : V extends ConstantMap
                  ? MapType<{ -readonly [K in keyof V & string]: ConstantTypeOf<V[K]> }>
                  : never;

/**
 * Rejects `constant([...])` calls whose array elements would infer distinct
 * descriptors: the type level would need a union of descriptor types while
 * the runtime holds a single element descriptor, so the two could not mirror.
 * The message type is what the invalid literal fails to unify with. Nested
 * arrays deeper inside maps are guarded at runtime instead (loud at
 * construction).
 */
type HomogeneousArrays<V> = V extends ConstantArray
  ? IsUnion<ConstantTypeOf<V[number]>> extends true
    ? ['constant array elements must share a single type']
    : unknown
  : unknown;

type IsUnion<T, U = T> = [T] extends [never]
  ? false
  : T extends unknown
    ? [U] extends [T]
      ? false
      : true
    : never;

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
  if (isConstantArray(value)) {
    const [first, ...rest] = value;
    if (first === undefined) {
      // Runtime twin of ConstantArray's non-empty tuple constraint.
      throw new Error('constant arrays must not be empty (no element to infer a type from)');
    }
    const element = constantTypeOf(first);
    // Runtime twin of the `HomogeneousArrays` rejection (and the guard for
    // nested arrays the type-level check cannot reach).
    for (const other of rest) {
      if (!descriptorEquals(element, constantTypeOf(other))) {
        throw new Error('constant array elements must share a single type');
      }
    }
    return array(element);
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

export const constant = <const V extends ConstantValue>(
  value: V & HomogeneousArrays<V>,
): Constant<ConstantTypeOf<V>> => Constant.of<V>(value);

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
export type UnaryFunctionName = 'not';

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
  | 'greaterThanOrEqual';

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
export type VariadicFunctionName = 'and' | 'or';

// Value-domain predicates: a descriptor whose phantom `output` (the value
// domain) is a subset of the given primitive — so literals, unions of the
// domain, and `& Optional` variants all qualify structurally, with no
// enumeration of descriptor constructors. See
// docs/plan/pipeline-query-expressions.md.
type NumberValued = FieldType & { output: number };
type StringValued = FieldType & { output: string };

// A comparison op has three overloads:
//   1) number-domain pair — Int64 / Double / numeric literals mix freely.
//   2) string-domain pair — string / string-literal / string-union operands
//      unify (e.g. a `literal('male','female')` field against `constant('male')`).
//   3) generic same-`T` — every other group; cross-group pairs match nothing.

export function equal(
  left: Expression<NumberValued>,
  right: Expression<NumberValued>,
): BinaryFunction<BoolType>;
export function equal(
  left: Expression<StringValued>,
  right: Expression<StringValued>,
): BinaryFunction<BoolType>;
export function equal<T extends FieldType>(
  left: Expression<T>,
  right: Expression<T>,
): BinaryFunction<BoolType>;
export function equal(left: Expression, right: Expression): BinaryFunction<BoolType> {
  return new BinaryFunction('equal', bool(), left, right);
}

export function notEqual(
  left: Expression<NumberValued>,
  right: Expression<NumberValued>,
): BinaryFunction<BoolType>;
export function notEqual(
  left: Expression<StringValued>,
  right: Expression<StringValued>,
): BinaryFunction<BoolType>;
export function notEqual<T extends FieldType>(
  left: Expression<T>,
  right: Expression<T>,
): BinaryFunction<BoolType>;
export function notEqual(left: Expression, right: Expression): BinaryFunction<BoolType> {
  return new BinaryFunction('notEqual', bool(), left, right);
}

export function lessThan(
  left: Expression<NumberValued>,
  right: Expression<NumberValued>,
): BinaryFunction<BoolType>;
export function lessThan(
  left: Expression<StringValued>,
  right: Expression<StringValued>,
): BinaryFunction<BoolType>;
export function lessThan<T extends FieldType>(
  left: Expression<T>,
  right: Expression<T>,
): BinaryFunction<BoolType>;
export function lessThan(left: Expression, right: Expression): BinaryFunction<BoolType> {
  return new BinaryFunction('lessThan', bool(), left, right);
}

export function lessThanOrEqual(
  left: Expression<NumberValued>,
  right: Expression<NumberValued>,
): BinaryFunction<BoolType>;
export function lessThanOrEqual(
  left: Expression<StringValued>,
  right: Expression<StringValued>,
): BinaryFunction<BoolType>;
export function lessThanOrEqual<T extends FieldType>(
  left: Expression<T>,
  right: Expression<T>,
): BinaryFunction<BoolType>;
export function lessThanOrEqual(left: Expression, right: Expression): BinaryFunction<BoolType> {
  return new BinaryFunction('lessThanOrEqual', bool(), left, right);
}

export function greaterThan(
  left: Expression<NumberValued>,
  right: Expression<NumberValued>,
): BinaryFunction<BoolType>;
export function greaterThan(
  left: Expression<StringValued>,
  right: Expression<StringValued>,
): BinaryFunction<BoolType>;
export function greaterThan<T extends FieldType>(
  left: Expression<T>,
  right: Expression<T>,
): BinaryFunction<BoolType>;
export function greaterThan(left: Expression, right: Expression): BinaryFunction<BoolType> {
  return new BinaryFunction('greaterThan', bool(), left, right);
}

export function greaterThanOrEqual(
  left: Expression<NumberValued>,
  right: Expression<NumberValued>,
): BinaryFunction<BoolType>;
export function greaterThanOrEqual(
  left: Expression<StringValued>,
  right: Expression<StringValued>,
): BinaryFunction<BoolType>;
export function greaterThanOrEqual<T extends FieldType>(
  left: Expression<T>,
  right: Expression<T>,
): BinaryFunction<BoolType>;
export function greaterThanOrEqual(left: Expression, right: Expression): BinaryFunction<BoolType> {
  return new BinaryFunction('greaterThanOrEqual', bool(), left, right);
}

/** Logical conjunction of two or more boolean expressions. */
export const and = (
  first: Expression<BoolType>,
  second: Expression<BoolType>,
  ...rest: Expression<BoolType>[]
): VariadicFunction<BoolType> => new VariadicFunction('and', bool(), [first, second, ...rest]);

/** Logical disjunction of two or more boolean expressions. */
export const or = (
  first: Expression<BoolType>,
  second: Expression<BoolType>,
  ...rest: Expression<BoolType>[]
): VariadicFunction<BoolType> => new VariadicFunction('or', bool(), [first, second, ...rest]);

/** Logical negation of a boolean expression. */
export const not = (condition: Expression<BoolType>): UnaryFunction<BoolType> =>
  new UnaryFunction('not', bool(), condition);
