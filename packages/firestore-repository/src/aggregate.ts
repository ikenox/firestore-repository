import type {
  DocumentSchema,
  DocFieldPath,
  DoubleType,
  FieldType,
  FieldTypeOfPath,
  Int64Type,
  NullType,
  UnionType,
} from './schema.js';

/** The result type of an aggregate query, resolved per aggregate method */
export type Aggregated<T extends AggregateSpec> = {
  [K in keyof T]: AggregatedValue<T[K]>;
};

/**
 * The value one aggregate method produces.
 *
 * Only {@link Average} can come back ABSENT: an mean needs at least one
 * numeric value, and Firestore answers `null` when the matched documents
 * supply none — an empty result set, a field no matched document carries, or
 * a field whose values are not numbers all reach that case (probed; pinned in
 * the live spec). {@link Count} and {@link Sum} have a defined answer for the
 * same input (`0`), so they are always a number.
 *
 * Keyed on the discriminant, so a new aggregate method cannot be added
 * without stating the value it produces.
 */
export type AggregatedValue<T extends AggregateMethod<DocumentSchema>> = {
  count: number;
  sum: number;
  average: number | null;
}[T['kind']];

/** A specification that defines which aggregate methods to apply to a query */
export type AggregateSpec<Schema extends DocumentSchema = DocumentSchema> = Record<
  string,
  AggregateMethod<Schema>
>;

/** A union of available aggregate methods: count, sum, or average */
export type AggregateMethod<Schema extends DocumentSchema> = Count | Sum<Schema> | Average<Schema>;

/** An aggregate method that counts the number of documents */
export type Count = { kind: 'count' };

type NumericFieldType = Int64Type | DoubleType;
type StripNull<T extends FieldType> =
  T extends UnionType<infer Elements> ? Exclude<Elements[number], NullType> : Exclude<T, NullType>;
type NumericField<T extends FieldType> = [StripNull<T>] extends [NumericFieldType] ? T : never;

/** A field path whose descriptor is numeric, optionally nullable */
export type NumericFieldPath<Schema extends DocumentSchema> = DocumentSchema extends Schema
  ? string
  : {
      [Path in DocFieldPath<Schema>]: NumericField<FieldTypeOfPath<Schema, Path>> extends never
        ? never
        : Path;
    }[DocFieldPath<Schema>];

/** An aggregate method that sums the values of a numeric field */
export type Sum<Schema extends DocumentSchema> = { kind: 'sum'; path: NumericFieldPath<Schema> };

/** An aggregate method that averages the values of a numeric field */
export type Average<Schema extends DocumentSchema> = {
  kind: 'average';
  path: NumericFieldPath<Schema>;
};

/** Creates a sum aggregate for the specified field */
export const sum = <Schema extends DocumentSchema>(
  path: NumericFieldPath<Schema>,
): Sum<Schema> => ({ kind: 'sum', path });

/** Creates an average aggregate for the specified field */
export const average = <Schema extends DocumentSchema>(
  path: NumericFieldPath<Schema>,
): Average<Schema> => ({ kind: 'average', path });

/** Creates a count aggregate */
export const count = (): Count => ({ kind: 'count' });
