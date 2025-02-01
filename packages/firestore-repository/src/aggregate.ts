import type { FieldPath } from './document.js';
import type { CollectionSchema, DbModel } from './schema.js';

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
