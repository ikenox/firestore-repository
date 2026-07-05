import { bool, type BoolType, type DoubleType, type FieldType, type Int64Type } from '../schema.js';

// NOTE: this module was trimmed to the AST core plus `field` / `constant` /
// `equal` (the only expression factories currently used). The full set of ~85
// SDK expression factories (arithmetic / string / array / map / timestamp /
// vector / ...) was removed pending a rework — see docs/plan/pipeline-query.md.

export type Expression<T extends FieldType = FieldType> = FunctionCall<T> | Constant<T> | Field<T>;

export type Field<T extends FieldType = FieldType, Path extends string = string> = {
  kind: 'field';
  type: T;
  path: Path;
};

/** Builds a field-reference expression node carrying its resolved `type`. */
export const field = <T extends FieldType, Path extends string>(
  type: T,
  path: Path,
): Field<T, Path> => ({ kind: 'field', type, path });

export type Constant<T extends FieldType> = {
  kind: 'constant';
  type: T;
  value: unknown; // TODO add type
};

export type FunctionCall<T extends FieldType = FieldType> = {
  kind: 'functionCall';
  name: string;
  type: T;
  args: readonly Expression[];
};

/** Convenience union for numeric expression inputs. */
type NumericType = Int64Type | DoubleType;

const fn = <T extends FieldType>(
  name: string,
  type: T,
  args: readonly Expression[],
): FunctionCall<T> => ({ kind: 'functionCall', name, type, args });

export const constant = <T extends FieldType>(value: unknown): Constant<T> => ({
  kind: 'constant',
  // TODO: derive the schema type from `value` (e.g. number -> DoubleType, string -> StringType).
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- placeholder result type until the TODO above is implemented (pipeline queries are WIP)
  type: 'todo' as unknown as T,
  value,
});

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
