import {
  type CollectionSchema,
  type DbModel,
  type FirestoreEnvironment,
  type MapValue,
  type ValueType,
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

export type Where = <T extends Query>(
  fieldPath: FieldPath<T['collection']>,
  opStr: WhereFilterOp,
  value: unknown, // TODO typing
) => QueryConstraint<T>;

export type OrderBy = <T extends Query>(
  field: FieldPath<T['collection']>,
  direction?: 'asc' | 'desc',
) => QueryConstraint<T>;

export type Limit = <T extends Query>(limit: number) => QueryConstraint<T>;

// limitToLast
// offset
// startAt
// startAfter
// endBefore
// endAt
// findNearest
// and
// or

// select
// aggregate

export type FieldPath<T extends CollectionSchema = CollectionSchema> =
  | {
      [K in keyof DbModel<T> & string]: K | `${K}.${ValueFieldPath<DbModel<T>[K]>}`;
    }[keyof DbModel<T> & string]
  | '__name__';

export type ValueFieldPath<T extends ValueType> = T extends MapValue
  ? { [K in keyof T]: K }[keyof T]
  : never;

export const aggregate = <T extends CollectionSchema>(query: Query<T>) => ({});

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
