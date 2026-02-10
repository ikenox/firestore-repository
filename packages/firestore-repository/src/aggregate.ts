import type { FieldPath } from './document.js';
import type { Collection, DocData } from './schema.js';

/** The result type of an aggregate query, where each key maps to a numeric value */
export type Aggregated<T extends AggregateSpec> = {
  [K in keyof T]: number;
};

/** A specification that defines which aggregate methods to apply to a query */
export type AggregateSpec<T extends Collection = Collection> = Record<string, AggregateMethod<T>>;

/** A union of available aggregate methods: count, sum, or average */
export type AggregateMethod<T extends Collection> = Count | Sum<T> | Average<T>;

/** An aggregate method that counts the number of documents */
export type Count = { kind: 'count' };

/** An aggregate method that sums the values of a numeric field */
export type Sum<T extends Collection> = { kind: 'sum'; path: FieldPath<DocData<T>> };

/** An aggregate method that averages the values of a numeric field */
export type Average<T extends Collection> = { kind: 'average'; path: FieldPath<DocData<T>> };

/** Creates a sum aggregate for the specified field */
export const sum = <T extends Collection>(path: FieldPath<DocData<T>>): Sum<T> => ({
  kind: 'sum',
  path,
});

/** Creates an average aggregate for the specified field */
export const average = <T extends Collection>(path: FieldPath<DocData<T>>): Average<T> => ({
  kind: 'average',
  path,
});

/** Creates a count aggregate */
export const count = (): Count => ({ kind: 'count' });
