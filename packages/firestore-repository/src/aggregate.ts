import type { FieldPath } from './document.js';
import type { Collection, DocData } from './schema.js';

export type Aggregated<T extends AggregateSpec> = {
  [K in keyof T]: number;
};
export type AggregateSpec<T extends Collection = Collection> = Record<string, AggregateMethod<T>>;
export type AggregateMethod<T extends Collection> = Count | Sum<T> | Average<T>;
export type Count = { kind: 'count' };
export type Sum<T extends Collection> = { kind: 'sum'; path: FieldPath<DocData<T>> };
export type Average<T extends Collection> = { kind: 'average'; path: FieldPath<DocData<T>> };
export const sum = <T extends Collection>(path: FieldPath<DocData<T>>): Sum<T> => ({
  kind: 'sum',
  path,
});
export const average = <T extends Collection>(path: FieldPath<DocData<T>>): Average<T> => ({
  kind: 'average',
  path,
});
export const count = (): Count => ({ kind: 'count' });
