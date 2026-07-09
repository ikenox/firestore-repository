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
export type Expression<T extends FieldType = FieldType> = FunctionCall<T> | Constant<T> | Field<T>;

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
  /** Binds this expression to an output name, forming a `select` / `addFields` selection. */
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

export class FunctionCall<T extends FieldType = FieldType> extends ExpressionBase {
  readonly kind = 'functionCall';
  constructor(
    readonly name: string,
    readonly type: T,
    readonly args: readonly Expression[],
  ) {
    super();
  }
}

/** Convenience union for numeric expression inputs. */
type NumericType = Int64Type | DoubleType;

const fn = <T extends FieldType>(
  name: string,
  type: T,
  args: readonly Expression[],
): FunctionCall<T> => new FunctionCall(name, type, args);

// A comparison op has two overloads:
//   1) numeric-pair — lets Int64 and Double mix while rejecting numeric-vs-other.
//   2) generic same-`T` — every other group plus union-vs-narrow widening.
export function equal(
  left: Expression<NumericType>,
  right: Expression<NumericType>,
): FunctionCall<BoolType>;
export function equal<T extends FieldType>(
  left: Expression<T>,
  right: Expression<T>,
): FunctionCall<BoolType>;
export function equal(left: Expression, right: Expression): FunctionCall<BoolType> {
  return fn('equal', bool(), [left, right]);
}
