import type { FieldPath, FieldValue, ValueType, WriteValue } from './document.js';
import type { FirestoreEnvironment } from './repository.js';
import type { CollectionSchema, DbModel } from './schema.js';

export const queryTag: unique symbol = Symbol();

/**
 * Query representation
 */
export type Query<
  T extends CollectionSchema = CollectionSchema,
  Env extends FirestoreEnvironment = FirestoreEnvironment,
> = {
  [queryTag]: true;
  collection: T;
  inner: Env['query'];
};

/**
 * Query constraint
 */
export type QueryConstraint<T extends Query> = (query: T['inner']) => T['inner'];
export type OrderBy<Env extends FirestoreEnvironment = FirestoreEnvironment> = <
  T extends CollectionSchema,
>(
  field: FieldPath<DbModel<T>>,
  direction?: 'asc' | 'desc',
) => QueryConstraint<Query<T, Env>>;
export type Limit<Env extends FirestoreEnvironment = FirestoreEnvironment> = <
  T extends CollectionSchema,
>(
  limit: number,
) => QueryConstraint<Query<T, Env>>;
export type LimitToLast<Env extends FirestoreEnvironment = FirestoreEnvironment> = <
  T extends CollectionSchema,
>(
  limit: number,
) => QueryConstraint<Query<T, Env>>;
export type Where<Env extends FirestoreEnvironment = FirestoreEnvironment> = <
  T extends CollectionSchema,
>(
  filter: FilterExpression<T>,
) => QueryConstraint<Query<T, Env>>;

export type FilterExpression<T extends CollectionSchema = CollectionSchema> =
  | UnaryCondition<T>
  | Or<T>
  | And<T>;
export type UnaryCondition<
  T extends CollectionSchema,
  Path extends FieldPath<DbModel<T>> = FieldPath<DbModel<T>>,
  Op extends WhereFilterOp = WhereFilterOp,
> = {
  kind: 'where';
  fieldPath: Path;
  opStr: Op;
  value: WriteValue<FilterOperand<FieldValue<DbModel<T>, Path>, Op>>;
};

// TODO
// startAt
// startAfter
// endBefore
// endAt
// findNearest
// and
// or
// select
// aggregate

export const condition = <
  T extends CollectionSchema,
  Path extends FieldPath<DbModel<T>>,
  Op extends WhereFilterOp,
>(
  fieldPath: Path,
  opStr: Op,
  value: WriteValue<FilterOperand<FieldValue<DbModel<T>, Path>, Op>>,
): UnaryCondition<T, Path> => ({ kind: 'where', fieldPath, opStr, value });

export type FilterOperand<T extends ValueType, U extends WhereFilterOp> = {
  // TODO accept only possible type for each operands
  '<': T;
  '<=': T;
  '==': T;
  '!=': T;
  '>=': T;
  '>': T;
  'array-contains': T extends (infer A)[] ? A : never;
  in: T extends (infer A)[] ? A : never;
  'not-in': T extends (infer A)[] ? A : never;
  'array-contains-any': T extends (infer A)[] ? A[] : never;
}[U];

export type WhereFilterOp =
  | '<'
  | '<='
  | '=='
  | '!='
  | '>='
  | '>'
  | 'array-contains'
  | 'in'
  | 'not-in'
  | 'array-contains-any';

export type Or<T extends CollectionSchema> = { kind: 'or'; filters: FilterExpression<T>[] };
export type And<T extends CollectionSchema> = { kind: 'and'; filters: FilterExpression<T>[] };

export const or = <T extends CollectionSchema>(...filters: FilterExpression<T>[]): Or<T> => ({
  kind: 'or',
  filters,
});
export const and = <T extends CollectionSchema>(...filters: FilterExpression<T>[]): And<T> => ({
  kind: 'and',
  filters,
});
