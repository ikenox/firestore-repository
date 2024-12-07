import {
  type CollectionSchema,
  type DbModel,
  type FieldPath,
  type FieldValue,
  type FilterOperand,
  type FirestoreEnvironment,
  type WriteValue,
  queryTag,
} from './index.js';

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
export type Or<T extends CollectionSchema> = { kind: 'or'; filters: FilterExpression<T>[] };
export type And<T extends CollectionSchema> = { kind: 'and'; filters: FilterExpression<T>[] };

export const $ = <
  T extends CollectionSchema,
  Path extends FieldPath<DbModel<T>>,
  Op extends WhereFilterOp,
>(
  fieldPath: Path,
  opStr: Op,
  value: WriteValue<FilterOperand<FieldValue<DbModel<T>, Path>, Op>>,
): UnaryCondition<T, Path> => ({ kind: 'where', fieldPath, opStr, value });
export const or = <T extends CollectionSchema>(...filters: FilterExpression<T>[]): Or<T> => ({
  kind: 'or',
  filters,
});
export const and = <T extends CollectionSchema>(...filters: FilterExpression<T>[]): And<T> => ({
  kind: 'and',
  filters,
});

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

export type Aggregated<T extends AggregateSpec> = {
  [K in keyof T]: number;
};
export type AggregateSpec<T extends CollectionSchema = CollectionSchema> = Record<
  string,
  AggregateMethod<T>
>;
export type AggregateMethod<T extends CollectionSchema> = Count | Sum<T> | Average<T>;
export type Count = { kind: 'count' };
export type Sum<T extends CollectionSchema> = { kind: 'sum'; path: FieldPath<DbModel<T>> };
export type Average<T extends CollectionSchema> = { kind: 'average'; path: FieldPath<DbModel<T>> };

export const sum = <T extends CollectionSchema>(path: FieldPath<DbModel<T>>): Sum<T> => ({
  kind: 'sum',
  path,
});
export const average = <T extends CollectionSchema>(path: FieldPath<DbModel<T>>): Average<T> => ({
  kind: 'average',
  path,
});
export const count = (): Count => ({
  kind: 'count',
});

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
