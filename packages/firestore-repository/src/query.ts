import type { FieldPath, FieldValue, ValueType, WriteValue } from './document.js';
import type { Collection, DocData, ParentDocRef } from './schema.js';

/**
 * A universal query definition
 */
export type Query<T extends Collection = Collection> = {
  base: QueryBase<T>;
  constraints?: QueryConstraint<T>[] | undefined;
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
  ...constraints: QueryConstraint<T>[]
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
export type QueryConstraint<T extends Collection = Collection> =
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
export type Where<T extends Collection = Collection> = {
  kind: 'where';
  condition: FilterExpression<T>;
};

/** A constraint that sorts results by a field */
export type OrderBy<T extends Collection> = {
  kind: 'orderBy';
  field: FieldPath<DocData<T>>;
  direction?: 'asc' | 'desc' | undefined;
};
/** Creates an orderBy constraint */
export const orderBy = <T extends Collection>(
  field: FieldPath<DocData<T>>,
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
export type StartAt<T extends Collection> = { kind: 'startAt'; cursor: Cursor<T> };
/** Creates a startAt cursor constraint (inclusive) */
export const startAt = <T extends Collection>(...cursor: Cursor<T>): StartAt<T> => ({
  kind: 'startAt',
  cursor,
});

/** A cursor constraint that starts after the given values (exclusive) */
export type StartAfter<T extends Collection> = { kind: 'startAfter'; cursor: Cursor<T> };
/** Creates a startAfter cursor constraint (exclusive) */
export const startAfter = <T extends Collection>(...cursor: Cursor<T>): StartAfter<T> => ({
  kind: 'startAfter',
  cursor,
});

/** A cursor constraint that ends at the given values (inclusive) */
export type EndAt<T extends Collection> = { kind: 'endAt'; cursor: Cursor<T> };
/** Creates an endAt cursor constraint (inclusive) */
export const endAt = <T extends Collection>(...cursor: Cursor<T>): EndAt<T> => ({
  kind: 'endAt',
  cursor,
});

/** A cursor constraint that ends before the given values (exclusive) */
export type EndBefore<T extends Collection> = { kind: 'endBefore'; cursor: Cursor<T> };
/** Creates an endBefore cursor constraint (exclusive) */
export const endBefore = <T extends Collection>(...cursor: Cursor<T>): EndBefore<T> => ({
  kind: 'endBefore',
  cursor,
});

/**
 * A list of values that correspond to the fields specified by the orderBy clause
 */
export type Cursor<_T extends Collection> = unknown[];

/**
 * A query filter expression
 */
export type FilterExpression<T extends Collection = Collection> =
  | FieldValueCondition<T>
  | Or<T>
  | And<T>;

/**
 * A single filter condition with a field path, operator, and value
 */
export type FieldValueCondition<
  T extends Collection,
  Path extends FieldPath<DocData<T>> = FieldPath<DocData<T>>,
  Op extends WhereFilterOp = WhereFilterOp,
> = {
  kind: 'fieldValueCondition';
  fieldPath: Path;
  opStr: Op;
  value: WriteValue<FilterOperand<FieldValue<DocData<T>, Path>, Op>>;
};

/**
 * Wraps a filter expression as a query constraint
 */
export const where = <T extends Collection>(condition: FilterExpression<T>): Where<T> => ({
  kind: 'where',
  condition,
});

/** Creates an equality filter (==) */
export const eq = <T extends Collection, Path extends FieldPath<DocData<T>>>(
  fieldPath: Path,
  value: WriteValue<FieldValue<DocData<T>, Path>>,
): FieldValueCondition<T, Path, '=='> => fieldValueCondition(fieldPath, '==', value);

/** Creates a not-equal filter (!=) */
export const ne = <T extends Collection, Path extends FieldPath<DocData<T>>>(
  fieldPath: Path,
  value: WriteValue<FieldValue<DocData<T>, Path>>,
): FieldValueCondition<T, Path, '!='> => fieldValueCondition(fieldPath, '!=', value);

/** Creates a less-than filter (<) */
export const lt = <T extends Collection, Path extends FieldPath<DocData<T>>>(
  fieldPath: Path,
  value: WriteValue<FieldValue<DocData<T>, Path>>,
): FieldValueCondition<T, Path, '<'> => fieldValueCondition(fieldPath, '<', value);

/** Creates a less-than-or-equal filter (<=) */
export const lte = <T extends Collection, Path extends FieldPath<DocData<T>>>(
  fieldPath: Path,
  value: WriteValue<FieldValue<DocData<T>, Path>>,
): FieldValueCondition<T, Path, '<='> => fieldValueCondition(fieldPath, '<=', value);

/** Creates a greater-than filter (>) */
export const gt = <T extends Collection, Path extends FieldPath<DocData<T>>>(
  fieldPath: Path,
  value: WriteValue<FieldValue<DocData<T>, Path>>,
): FieldValueCondition<T, Path, '>'> => fieldValueCondition(fieldPath, '>', value);

/** Creates a greater-than-or-equal filter (>=) */
export const gte = <T extends Collection, Path extends FieldPath<DocData<T>>>(
  fieldPath: Path,
  value: WriteValue<FieldValue<DocData<T>, Path>>,
): FieldValueCondition<T, Path, '>='> => fieldValueCondition(fieldPath, '>=', value);

/** Creates an array-contains filter */
export const arrayContains = <T extends Collection, Path extends FieldPath<DocData<T>>>(
  fieldPath: Path,
  value: WriteValue<FilterOperand<FieldValue<DocData<T>, Path>, 'array-contains'>>,
): FieldValueCondition<T, Path, 'array-contains'> =>
  fieldValueCondition(fieldPath, 'array-contains', value);

/** Creates an array-contains-any filter */
export const arrayContainsAny = <T extends Collection, Path extends FieldPath<DocData<T>>>(
  fieldPath: Path,
  value: WriteValue<FilterOperand<FieldValue<DocData<T>, Path>, 'array-contains-any'>>,
): FieldValueCondition<T, Path, 'array-contains-any'> =>
  fieldValueCondition(fieldPath, 'array-contains-any', value);

/** Creates an in filter */
export const inArray = <T extends Collection, Path extends FieldPath<DocData<T>>>(
  fieldPath: Path,
  value: WriteValue<FilterOperand<FieldValue<DocData<T>, Path>, 'in'>>,
): FieldValueCondition<T, Path, 'in'> => fieldValueCondition(fieldPath, 'in', value);

/** Creates a not-in filter */
export const notIn = <T extends Collection, Path extends FieldPath<DocData<T>>>(
  fieldPath: Path,
  value: WriteValue<FilterOperand<FieldValue<DocData<T>, Path>, 'not-in'>>,
): FieldValueCondition<T, Path, 'not-in'> => fieldValueCondition(fieldPath, 'not-in', value);

const fieldValueCondition = <
  T extends Collection,
  Path extends FieldPath<DocData<T>>,
  Op extends WhereFilterOp,
>(
  fieldPath: Path,
  opStr: Op,
  value: WriteValue<FilterOperand<FieldValue<DocData<T>, Path>, Op>>,
): FieldValueCondition<T, Path, Op> => ({ kind: 'fieldValueCondition', fieldPath, opStr, value });

/**
 * The operand type for a filter condition operator
 */
export type FilterOperand<T extends ValueType, U extends WhereFilterOp> = {
  '<': T;
  '<=': T;
  '==': T;
  '!=': T;
  '>=': T;
  '>': T;
  in: T[];
  'not-in': T[];
  'array-contains': T extends (infer A)[] ? A : never;
  'array-contains-any': T extends (infer A)[] ? A[] : never;
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
export type Or<T extends Collection> = { kind: 'or'; filters: FilterExpression<T>[] };
/** A composite filter that matches if all of the given filters match */
export type And<T extends Collection> = { kind: 'and'; filters: FilterExpression<T>[] };

/** Creates an OR composite filter */
export const or = <T extends Collection>(...filters: FilterExpression<T>[]): Or<T> => ({
  kind: 'or',
  filters,
});
/** Creates an AND composite filter */
export const and = <T extends Collection>(...filters: FilterExpression<T>[]): And<T> => ({
  kind: 'and',
  filters,
});
