import type { FieldPath, FieldValue, ValueType, WriteValue } from './document.js';
import type { Collection, DocData, ParentDocRef } from './schema.js';

/**
 * An universal query definition
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
  // biome-ignore lint/plugin/no-type-assertion: schema without validation
  return { base: { ...base, parent: base.parent ?? ([] as ParentDocRef<T>) }, constraints };
};

/**
 * Query constraint
 */
export type QueryConstraint<T extends Collection = Collection> =
  | FilterExpression<T>
  | OrderBy<T>
  | StartAt<T>
  | StartAfter<T>
  | EndAt<T>
  | EndBefore<T>
  | Limit
  | LimitToLast
  | Offset;

export type OrderBy<T extends Collection> = {
  kind: 'orderBy';
  field: FieldPath<DocData<T>>;
  direction?: 'asc' | 'desc' | undefined;
};
export const orderBy = <T extends Collection>(
  field: FieldPath<DocData<T>>,
  direction?: 'asc' | 'desc' | undefined,
): OrderBy<T> => ({ kind: 'orderBy', field, direction });

export type Limit = { kind: 'limit'; limit: number };
export const limit = (limit: number): Limit => ({ kind: 'limit', limit });

export type LimitToLast = { kind: 'limitToLast'; limit: number };
export const limitToLast = (limit: number): LimitToLast => ({ kind: 'limitToLast', limit });

export type Offset = { kind: 'offset'; offset: number };

export type StartAt<T extends Collection> = { kind: 'startAt'; cursor: Cursor<T> };
export const startAt = <T extends Collection>(...cursor: Cursor<T>): StartAt<T> => ({
  kind: 'startAt',
  cursor,
});

export type StartAfter<T extends Collection> = { kind: 'startAfter'; cursor: Cursor<T> };
export const startAfter = <T extends Collection>(...cursor: Cursor<T>): StartAfter<T> => ({
  kind: 'startAfter',
  cursor,
});

export type EndAt<T extends Collection> = { kind: 'endAt'; cursor: Cursor<T> };
export const endAt = <T extends Collection>(...cursor: Cursor<T>): EndAt<T> => ({
  kind: 'endAt',
  cursor,
});

export type EndBefore<T extends Collection> = { kind: 'endBefore'; cursor: Cursor<T> };
export const endBefore = <T extends Collection>(...cursor: Cursor<T>): EndBefore<T> => ({
  kind: 'endBefore',
  cursor,
});

/**
 * A list of values that should correspond to the columns specified by orderBy clause
 */
export type Cursor<_T extends Collection> = unknown[];

/**
 * An expression of query filter condition
 */
export type FilterExpression<T extends Collection = Collection> =
  | UnaryCondition<T>
  | Or<T>
  | And<T>;

/**
 * A single filter condition with a field path, operator, and value
 */
export type UnaryCondition<
  T extends Collection,
  Path extends FieldPath<DocData<T>> = FieldPath<DocData<T>>,
  Op extends WhereFilterOp = WhereFilterOp,
> = {
  kind: 'where';
  fieldPath: Path;
  opStr: Op;
  value: WriteValue<FilterOperand<FieldValue<DocData<T>, Path>, Op>>;
};

/**
 * Returns a single filter condition
 */
export const condition = <
  T extends Collection,
  Path extends FieldPath<DocData<T>>,
  Op extends WhereFilterOp,
>(
  fieldPath: Path,
  opStr: Op,
  value: WriteValue<FilterOperand<FieldValue<DocData<T>, Path>, Op>>,
): UnaryCondition<T, Path, Op> => ({ kind: 'where', fieldPath, opStr, value });

/**
 * An operand type of the filter condition operator
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
 * An operator of the filter condition
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

export type Or<T extends Collection> = { kind: 'or'; filters: FilterExpression<T>[] };
export type And<T extends Collection> = { kind: 'and'; filters: FilterExpression<T>[] };

export const or = <T extends Collection>(...filters: FilterExpression<T>[]): Or<T> => ({
  kind: 'or',
  filters,
});
export const and = <T extends Collection>(...filters: FilterExpression<T>[]): And<T> => ({
  kind: 'and',
  filters,
});
