import { ParentDocRef } from './repository.js';
import type {
  ArrayType,
  Collection,
  DocumentSchema,
  FieldPath,
  FieldType,
  FieldTypeOfPath,
  FieldValue,
} from './schema.js';

/**
 * A universal query definition
 */
export type Query<T extends Collection = Collection> = {
  base: QueryBase<T>;
  constraints?: QueryConstraint<T['schema']>[] | undefined;
};

/**
 * A starting point to build a new query
 */
export type QueryBase<T extends Collection> =
  /**
   * Target collection to query
   */
  | { collection: T; parent: ParentDocRef<T>; group?: false }
  /**
   * Collection group query
   */
  | { collection: T; group: true }
  /**
   * Extends another query
   */
  | { extends: Query<T> };

/** Input type for specifying the base of a query */
export type QueryBaseInput<T extends Collection = Collection> =
  /**
   * Target collection to query
   */
  | (T['parent']['length'] extends 0
      ? // Root Collection
        { collection: T; group?: false; parent?: ParentDocRef<T> }
      : // Subcollection
        { collection: T; group?: false; parent: ParentDocRef<T> })
  /**
   * Collection group query
   */
  | { collection: T; group: true }
  /**
   * Extends another query
   */
  | { extends: Query<T> };

/**
 * Builds a new query
 */
export const query = <T extends Collection>(
  base: QueryBaseInput<T>,
  ...constraints: QueryConstraint<T['schema']>[]
): Query<T> => {
  if ('extends' in base || base.group) {
    return { base, constraints };
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- schema without validation
  return { base: { ...base, parent: base.parent ?? ([] as ParentDocRef<T>) }, constraints };
};

/**
 * A query constraint
 */
export type QueryConstraint<T extends DocumentSchema = DocumentSchema> =
  | Where<T>
  | OrderBy<T>
  | StartAt<T>
  | StartAfter<T>
  | EndAt<T>
  | EndBefore<T>
  | Limit
  | LimitToLast
  | Offset;

/**
 * A where constraint that wraps a filter expression
 */
export type Where<T extends DocumentSchema = DocumentSchema> = {
  kind: 'where';
  condition: FilterExpression<T>;
};

/** A constraint that sorts results by a field */
export type OrderBy<T extends DocumentSchema> = {
  kind: 'orderBy';
  field: FieldPath<T>;
  direction?: 'asc' | 'desc' | undefined;
};
/** Creates an orderBy constraint */
export const orderBy = <T extends DocumentSchema>(
  field: FieldPath<T>,
  direction?: 'asc' | 'desc' | undefined,
): OrderBy<T> => ({ kind: 'orderBy', field, direction });

/** A constraint that limits the number of results */
export type Limit = { kind: 'limit'; limit: number };
/** Creates a limit constraint */
export const limit = (limit: number): Limit => ({ kind: 'limit', limit });

/** A constraint that limits the number of results from the end */
export type LimitToLast = { kind: 'limitToLast'; limit: number };
/** Creates a limitToLast constraint */
export const limitToLast = (limit: number): LimitToLast => ({ kind: 'limitToLast', limit });

/** A constraint that skips the first N results */
export type Offset = { kind: 'offset'; offset: number };

/** A cursor constraint that starts at the given values (inclusive) */
export type StartAt<T extends DocumentSchema> = { kind: 'startAt'; cursor: Cursor<T> };
/** Creates a startAt cursor constraint (inclusive) */
export const startAt = <T extends DocumentSchema>(...cursor: Cursor<T>): StartAt<T> => ({
  kind: 'startAt',
  cursor,
});

/** A cursor constraint that starts after the given values (exclusive) */
export type StartAfter<T extends DocumentSchema> = { kind: 'startAfter'; cursor: Cursor<T> };
/** Creates a startAfter cursor constraint (exclusive) */
export const startAfter = <T extends DocumentSchema>(...cursor: Cursor<T>): StartAfter<T> => ({
  kind: 'startAfter',
  cursor,
});

/** A cursor constraint that ends at the given values (inclusive) */
export type EndAt<T extends DocumentSchema> = { kind: 'endAt'; cursor: Cursor<T> };
/** Creates an endAt cursor constraint (inclusive) */
export const endAt = <T extends DocumentSchema>(...cursor: Cursor<T>): EndAt<T> => ({
  kind: 'endAt',
  cursor,
});

/** A cursor constraint that ends before the given values (exclusive) */
export type EndBefore<T extends DocumentSchema> = { kind: 'endBefore'; cursor: Cursor<T> };
/** Creates an endBefore cursor constraint (exclusive) */
export const endBefore = <T extends DocumentSchema>(...cursor: Cursor<T>): EndBefore<T> => ({
  kind: 'endBefore',
  cursor,
});

/**
 * A list of values that correspond to the fields specified by the orderBy clause
 */
export type Cursor<_T extends DocumentSchema> = unknown[];

/**
 * A query filter expression
 */
export type FilterExpression<T extends DocumentSchema = DocumentSchema> =
  | FieldValueCondition<T>
  | Or<T>
  | And<T>;

/**
 * A single filter condition with a field path, operator, and value
 */
export type FieldValueCondition<
  Schema extends DocumentSchema,
  Path extends FieldPath<Schema> = FieldPath<Schema>,
  Op extends WhereFilterOp = WhereFilterOp,
> = {
  kind: 'fieldValueCondition';
  fieldPath: Path;
  opStr: Op;
  value: FilterOperandValue<Schema, Path, Op>;
};

export type FilterOperandValue<
  Schema extends DocumentSchema,
  Path extends FieldPath<Schema> = FieldPath<Schema>,
  Op extends WhereFilterOp = WhereFilterOp,
> = FieldValue<FilterOperand<FieldTypeOfPath<Schema, Path>, Op>, 'read'>;

/**
 * Wraps filter expressions as a query constraint.
 * When multiple filters are provided, they are combined with AND condition.
 *
 * @example
 * // Single filter
 * where(eq('name', 'John'))
 *
 * @example
 * // Multiple filters (combined with AND)
 * where(eq('name', 'John'), gte('age', 20))
 */
export const where = <T extends DocumentSchema>(
  ...conditions: FilterExpression<T>[]
): Where<T> => ({ kind: 'where', condition: and<T>(...conditions) });

/**
 * Creates an equality filter (==).
 * Matches documents where the field equals the specified value.
 *
 * @example
 * eq('status', 'active')
 */
export const eq = <T extends DocumentSchema, Path extends FieldPath<T>>(
  fieldPath: Path,
  value: FilterOperandValue<T, Path, '=='>,
): FieldValueCondition<T, Path, '=='> => fieldValueCondition(fieldPath, '==', value);

/**
 * Creates a not-equal filter (!=).
 * Matches documents where the field does not equal the specified value.
 *
 * @example
 * ne('status', 'deleted')
 */
export const ne = <T extends DocumentSchema, Path extends FieldPath<T>>(
  fieldPath: Path,
  value: FilterOperandValue<T, Path, '!='>,
): FieldValueCondition<T, Path, '!='> => fieldValueCondition(fieldPath, '!=', value);

/**
 * Creates a less-than filter (<).
 * Matches documents where the field is less than the specified value.
 *
 * @example
 * lt('age', 18)
 */
export const lt = <T extends DocumentSchema, Path extends FieldPath<T>>(
  fieldPath: Path,
  value: FilterOperandValue<T, Path, '<'>,
): FieldValueCondition<T, Path, '<'> => fieldValueCondition(fieldPath, '<', value);

/**
 * Creates a less-than-or-equal filter (<=).
 * Matches documents where the field is less than or equal to the specified value.
 *
 * @example
 * lte('price', 100)
 */
export const lte = <T extends DocumentSchema, Path extends FieldPath<T>>(
  fieldPath: Path,
  value: FilterOperandValue<T, Path, '<='>,
): FieldValueCondition<T, Path, '<='> => fieldValueCondition(fieldPath, '<=', value);

/**
 * Creates a greater-than filter (>).
 * Matches documents where the field is greater than the specified value.
 *
 * @example
 * gt('score', 50)
 */
export const gt = <T extends DocumentSchema, Path extends FieldPath<T>>(
  fieldPath: Path,
  value: FilterOperandValue<T, Path, '>'>,
): FieldValueCondition<T, Path, '>'> => fieldValueCondition(fieldPath, '>', value);

/**
 * Creates a greater-than-or-equal filter (>=).
 * Matches documents where the field is greater than or equal to the specified value.
 *
 * @example
 * gte('age', 20)
 */
export const gte = <T extends DocumentSchema, Path extends FieldPath<T>>(
  fieldPath: Path,
  value: FilterOperandValue<T, Path, '>='>,
): FieldValueCondition<T, Path, '>='> => fieldValueCondition(fieldPath, '>=', value);

/**
 * Creates an array-contains filter.
 * Matches documents where the array field contains the specified element.
 *
 * @example
 * arrayContains('tags', 'featured')
 */
export const arrayContains = <T extends DocumentSchema, Path extends FieldPath<T>>(
  fieldPath: Path,
  value: FilterOperandValue<T, Path, 'array-contains'>,
): FieldValueCondition<T, Path, 'array-contains'> =>
  fieldValueCondition(fieldPath, 'array-contains', value);

/**
 * Creates an array-contains-any filter.
 * Matches documents where the array field contains any of the specified elements.
 *
 * @example
 * arrayContainsAny('tags', ['featured', 'new'])
 */
export const arrayContainsAny = <T extends DocumentSchema, Path extends FieldPath<T>>(
  fieldPath: Path,
  value: FilterOperandValue<T, Path, 'array-contains-any'>,
): FieldValueCondition<T, Path, 'array-contains-any'> =>
  fieldValueCondition(fieldPath, 'array-contains-any', value);

/**
 * Creates an in filter.
 * Matches documents where the field value is in the specified array.
 *
 * @example
 * inArray('status', ['active', 'pending'])
 */
export const inArray = <T extends DocumentSchema, Path extends FieldPath<T>>(
  fieldPath: Path,
  value: FilterOperandValue<T, Path, 'in'>,
): FieldValueCondition<T, Path, 'in'> => fieldValueCondition(fieldPath, 'in', value);

/**
 * Creates a not-in filter.
 * Matches documents where the field value is not in the specified array.
 *
 * @example
 * notIn('status', ['deleted', 'archived'])
 */
export const notIn = <T extends DocumentSchema, Path extends FieldPath<T>>(
  fieldPath: Path,
  value: FilterOperandValue<T, Path, 'not-in'>,
): FieldValueCondition<T, Path, 'not-in'> => fieldValueCondition(fieldPath, 'not-in', value);

const fieldValueCondition = <
  Schema extends DocumentSchema,
  Path extends FieldPath<Schema>,
  Op extends WhereFilterOp,
>(
  fieldPath: Path,
  opStr: Op,
  value: FilterOperandValue<Schema, Path, Op>,
): FieldValueCondition<Schema, Path, Op> => ({
  kind: 'fieldValueCondition',
  fieldPath,
  opStr,
  value,
});

/**
 * The operand type for a filter condition operator
 */
export type FilterOperand<T extends FieldType, U extends WhereFilterOp> = {
  '<': T;
  '<=': T;
  '==': T;
  '!=': T;
  '>=': T;
  '>': T;
  in: ArrayType<T>;
  'not-in': ArrayType<T>;
  // TODO: support tuple
  'array-contains': T extends ArrayType<infer A> ? A : never;
  'array-contains-any': T extends ArrayType<infer A> ? ArrayType<A> : never;
}[U];

/**
 * A filter condition operator
 */
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

/** A composite filter that matches if any of the given filters match */
export type Or<T extends DocumentSchema> = { kind: 'or'; filters: FilterExpression<T>[] };
/** A composite filter that matches if all of the given filters match */
export type And<T extends DocumentSchema> = { kind: 'and'; filters: FilterExpression<T>[] };

/** Creates an OR composite filter */
export const or = <T extends DocumentSchema>(...filters: FilterExpression<T>[]): Or<T> => ({
  kind: 'or',
  filters,
});
/** Creates an AND composite filter */
export const and = <T extends DocumentSchema>(...filters: FilterExpression<T>[]): And<T> => ({
  kind: 'and',
  filters,
});
