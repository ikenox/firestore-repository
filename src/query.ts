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

export type Where<T extends Query> = (
  fieldPath: FieldPath<T['collection']>,
  opStr: WhereFilterOp,
  value: unknown,
) => QueryConstraint<T>;

export type OrderBy<T extends Query> = (
  columns: keyof DbModel<T['collection']>,
) => QueryConstraint<T>;

export type Limit = (limit: number) => QueryConstraint<never>;

// limit
// orderBy
// limitToLast
// offset
// select
// startAt
// startAfter
// endBefore
// endAt
// findNearest
// and
// or

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
