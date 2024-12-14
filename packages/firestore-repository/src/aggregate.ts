import type { FieldPath } from './document.js';
import type { Query } from './query.js';
import type { CollectionSchema, DbModel } from './schema.js';

export type AggregateQuery<T extends CollectionSchema = CollectionSchema> = {
  query: Query<T>;
  spec: AggregateSpec<T>;
};

export type Aggregated<T extends AggregateQuery> = {
  [K in keyof T['spec']]: number;
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
