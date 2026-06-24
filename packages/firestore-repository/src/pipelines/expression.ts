import { bool, type BoolType, type FieldType } from '../schema.js';

export type Expression<T extends FieldType = FieldType> = Equal | Constant<T> | Field<T>;

export type Constant<T extends FieldType> = {
  kind: 'constant';
  type: T;
  value: unknown; // TODO add type
};

export type Equal = {
  kind: 'equal';
  type: BoolType;
  left: Expression;
  right: Expression;
};

export type Field<T extends FieldType = FieldType, Path extends string = string> = {
  type: T;
  path: Path;
};

export const constant = <T extends FieldType>(value: unknown): Constant<T> => ({
  kind: 'constant',
  type: 'todo' as unknown as T,
  value,
});

export const equal = <T extends FieldType>(
  left: Expression<T>,
  // TODO: restrict `right` to expressions whose value type is compatible with `left`'s.
  right: Expression,
): Equal => ({
  kind: 'equal',
  type: bool(),
  left,
  right,
});
