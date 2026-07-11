import { bool, type BoolType, type DoubleType, type FieldType, type Int64Type } from '../schema.js';

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
  constructor(
    readonly type: T,
    readonly value: unknown, // TODO add type
  ) {
    super();
  }
}

export const constant = <T extends FieldType>(value: unknown): Constant<T> =>
  new Constant(
    // TODO: derive the schema type from `value` (e.g. number -> DoubleType, string -> StringType).
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- placeholder result type until the TODO above is implemented (pipeline queries are WIP)
    'todo' as unknown as T,
    value,
  );

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

/** Convenience union for numeric expression inputs. */
type NumericType = Int64Type | DoubleType;

// A comparison op has two overloads:
//   1) numeric-pair — lets Int64 and Double mix while rejecting numeric-vs-other.
//   2) generic same-`T` — every other group plus union-vs-narrow widening.

export function equal(
  left: Expression<NumericType>,
  right: Expression<NumericType>,
): BinaryFunction<BoolType>;
export function equal<T extends FieldType>(
  left: Expression<T>,
  right: Expression<T>,
): BinaryFunction<BoolType>;
export function equal(left: Expression, right: Expression): BinaryFunction<BoolType> {
  return new BinaryFunction('equal', bool(), left, right);
}

export function notEqual(
  left: Expression<NumericType>,
  right: Expression<NumericType>,
): BinaryFunction<BoolType>;
export function notEqual<T extends FieldType>(
  left: Expression<T>,
  right: Expression<T>,
): BinaryFunction<BoolType>;
export function notEqual(left: Expression, right: Expression): BinaryFunction<BoolType> {
  return new BinaryFunction('notEqual', bool(), left, right);
}

export function lessThan(
  left: Expression<NumericType>,
  right: Expression<NumericType>,
): BinaryFunction<BoolType>;
export function lessThan<T extends FieldType>(
  left: Expression<T>,
  right: Expression<T>,
): BinaryFunction<BoolType>;
export function lessThan(left: Expression, right: Expression): BinaryFunction<BoolType> {
  return new BinaryFunction('lessThan', bool(), left, right);
}

export function lessThanOrEqual(
  left: Expression<NumericType>,
  right: Expression<NumericType>,
): BinaryFunction<BoolType>;
export function lessThanOrEqual<T extends FieldType>(
  left: Expression<T>,
  right: Expression<T>,
): BinaryFunction<BoolType>;
export function lessThanOrEqual(left: Expression, right: Expression): BinaryFunction<BoolType> {
  return new BinaryFunction('lessThanOrEqual', bool(), left, right);
}

export function greaterThan(
  left: Expression<NumericType>,
  right: Expression<NumericType>,
): BinaryFunction<BoolType>;
export function greaterThan<T extends FieldType>(
  left: Expression<T>,
  right: Expression<T>,
): BinaryFunction<BoolType>;
export function greaterThan(left: Expression, right: Expression): BinaryFunction<BoolType> {
  return new BinaryFunction('greaterThan', bool(), left, right);
}

export function greaterThanOrEqual(
  left: Expression<NumericType>,
  right: Expression<NumericType>,
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
