import type { DocumentSchema, FieldPath } from './schema.js';

/** The result type of an aggregate query, where each key maps to a numeric value */
export type Aggregated<T extends AggregateSpec> = {
  [K in keyof T]: number;
};

/** A specification that defines which aggregate methods to apply to a query */
export type AggregateSpec<Schema extends DocumentSchema = DocumentSchema> = Record<
  string,
  AggregateMethod<Schema>
>;

/** A union of available aggregate methods: count, sum, or average */
export type AggregateMethod<Schema extends DocumentSchema> = Count | Sum<Schema> | Average<Schema>;

/** An aggregate method that counts the number of documents */
export type Count = { kind: 'count' };

/** An aggregate method that sums the values of a numeric field */
export type Sum<Schema extends DocumentSchema> = { kind: 'sum'; path: FieldPath<Schema> };

/** An aggregate method that averages the values of a numeric field */
export type Average<Schema extends DocumentSchema> = { kind: 'average'; path: FieldPath<Schema> };

/** Creates a sum aggregate for the specified field */
export const sum = <Schema extends DocumentSchema>(path: FieldPath<Schema>): Sum<Schema> => ({
  kind: 'sum',
  path,
});

/** Creates an average aggregate for the specified field */
export const average = <Schema extends DocumentSchema>(
  path: FieldPath<Schema>,
): Average<Schema> => ({ kind: 'average', path });

/** Creates a count aggregate */
export const count = (): Count => ({ kind: 'count' });
