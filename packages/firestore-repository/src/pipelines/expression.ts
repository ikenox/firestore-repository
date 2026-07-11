import {
  bool,
  type BoolType,
  bytes,
  type BytesType,
  double,
  type DoubleType,
  type FieldType,
  type GeoPoint,
  geoPoint,
  type GeoPointType,
  nullType,
  type NullType,
  string,
  type StringType,
  timestamp,
  type TimestampType,
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
  constructor(readonly value: ConstantValue) {
    super();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the runtime mapping mirrors the type-level `ConstantTypeOf`; `T` is pinned to it by the `constant` factory's return type
    this.type = constantTypeOf(value) as T;
  }
}

/**
 * The value domain `constant()` accepts — the unambiguous scalar types.
 * Deliberately excluded for now: document refs (need collection context),
 * arrays / maps (the `ArrayValue` / `MapValue` constructors), and vectors
 * (indistinguishable from `number[]`).
 */
export type ConstantValue = string | number | boolean | null | Date | Uint8Array | GeoPoint;

/**
 * The descriptor a constant value infers to. All JS numbers map to
 * `DoubleType` — the SDK decides integer/double wire encoding itself, and the
 * descriptor's client-side roles (operand domains, projected-schema decode)
 * treat the two identically.
 */
export type ConstantTypeOf<V extends ConstantValue> = V extends null
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
            : V extends GeoPoint
              ? GeoPointType
              : never;

/** Runtime counterpart of {@link ConstantTypeOf} (same branch order). */
const constantTypeOf = (value: ConstantValue): FieldType => {
  if (value === null) {
    return nullType();
  }
  if (value instanceof Date) {
    return timestamp();
  }
  if (value instanceof Uint8Array) {
    return bytes();
  }
  switch (typeof value) {
    case 'string':
      return string();
    case 'number':
      return double();
    case 'boolean':
      return bool();
    case 'object':
      return geoPoint(); // the only remaining ConstantValue object type
    case 'bigint':
    case 'symbol':
    case 'undefined':
    case 'function':
      // Impossible for a ConstantValue — `value` is narrowed to `never` here.
      return assertNever(value);
    default:
      return assertNever(value);
  }
};

export const constant = <const V extends ConstantValue>(value: V): Constant<ConstantTypeOf<V>> =>
  new Constant(value);

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
