import type { FieldPath, FieldValue, ValueType, WriteValue } from './document.js';
import {
  type CollectionSchema,
  type DbModel,
  type IsRootCollection,
  type ParentId,
  collectionSchemaTag,
} from './schema.js';

export class Query<T extends CollectionSchema = CollectionSchema> {
  constructor(
    readonly base:
      | { kind: 'collection'; collection: T; parentId: ParentId<T> }
      | { kind: 'collectionGroup'; collection: T }
      | { kind: 'extends'; query: Query<T> },
    readonly constraints?: QueryConstraint<T>[],
  ) {}
}

export type QueryBase<T extends CollectionSchema> =
  // collection schema, only for root collection
  | (IsRootCollection<T> extends true ? T : never)
  // for subcollection
  | { collection: T; parent: ParentId<T> }
  // or extends another query
  | Query<T>;

export const query = <T extends CollectionSchema>(
  base: QueryBase<T>,
  ...constraints: QueryConstraint<T>[]
): Query<T> => {
  if (base instanceof Query) {
    // extends another query
    return new Query({ kind: 'extends', query: base }, constraints);
  }
  if (collectionSchemaTag in base) {
    // root collection
    return new Query(
      { kind: 'collection', collection: base, parentId: {} as ParentId<T> },
      constraints,
    );
  }
  // subcollection
  return new Query(
    { kind: 'collection', collection: base.collection, parentId: base.parent },
    constraints,
  );
};

export const collectionGroupQuery = <T extends CollectionSchema>(
  collection: T,
  ...constraints: QueryConstraint<T>[]
): Query<T> => {
  return new Query({ kind: 'collectionGroup', collection }, constraints);
};

/**
 * Query constraint
 */
export type QueryConstraint<T extends CollectionSchema = CollectionSchema> =
  | Where<T>
  | OrderBy<T>
  | StartAt<T>
  | StartAfter<T>
  | EndAt<T>
  | EndBefore<T>
  | Limit
  | LimitToLast
  | Offset;

export type Where<T extends CollectionSchema> = {
  kind: 'where';
  filter: FilterExpression<T>;
};
export const where = <T extends CollectionSchema>(filter: FilterExpression<T>): Where<T> => ({
  kind: 'where',
  filter,
});

export type OrderBy<T extends CollectionSchema> = {
  kind: 'orderBy';
  field: FieldPath<DbModel<T>>;
  direction?: 'asc' | 'desc' | undefined;
};
export const orderBy = <T extends CollectionSchema>(
  field: FieldPath<DbModel<T>>,
  direction?: 'asc' | 'desc' | undefined,
): OrderBy<T> => ({ kind: 'orderBy', field, direction });

export type Limit = { kind: 'limit'; limit: number };
export const limit = (limit: number): Limit => ({ kind: 'limit', limit });

export type LimitToLast = { kind: 'limitToLast'; limit: number };
export const limitToLast = (limit: number): LimitToLast => ({
  kind: 'limitToLast',
  limit,
});

export type Offset = { kind: 'offset'; offset: number };

export type StartAt<T extends CollectionSchema> = { kind: 'startAt'; cursor: Cursor<T> };
export const startAt = <T extends CollectionSchema>(...cursor: Cursor<T>): StartAt<T> => ({
  kind: 'startAt',
  cursor,
});

export type StartAfter<T extends CollectionSchema> = {
  kind: 'startAfter';
  cursor: Cursor<T>;
};
export const startAfter = <T extends CollectionSchema>(...cursor: Cursor<T>): StartAfter<T> => ({
  kind: 'startAfter',
  cursor,
});

export type EndAt<T extends CollectionSchema> = { kind: 'endAt'; cursor: Cursor<T> };
export const endAt = <T extends CollectionSchema>(...cursor: Cursor<T>): EndAt<T> => ({
  kind: 'endAt',
  cursor,
});

export type EndBefore<T extends CollectionSchema> = {
  kind: 'endBefore';
  cursor: Cursor<T>;
};
export const endBefore = <T extends CollectionSchema>(...cursor: Cursor<T>): EndBefore<T> => ({
  kind: 'endBefore',
  cursor,
});

export type Cursor<_T extends CollectionSchema> =
  // a list of values, that should correspond to the columns specified by orderBy clause
  unknown[];

export type FilterExpression<T extends CollectionSchema = CollectionSchema> =
  | UnaryCondition<T>
  | Or<T>
  | And<T>;
export type UnaryCondition<
  T extends CollectionSchema,
  Path extends FieldPath<DbModel<T>> = FieldPath<DbModel<T>>,
  Op extends WhereFilterOp = WhereFilterOp,
> = {
  kind: 'where';
  fieldPath: Path;
  opStr: Op;
  value: WriteValue<FilterOperand<FieldValue<DbModel<T>, Path>, Op>>;
};

/**
 * Returns a single filter condition
 */
export const condition = <
  Path extends FieldPath<DbModel<T>>,
  T extends CollectionSchema,
  Op extends WhereFilterOp,
>(
  fieldPath: Path,
  opStr: Op,
  value: WriteValue<FilterOperand<FieldValue<DbModel<T>, Path>, Op>>,
): UnaryCondition<T, Path> => ({ kind: 'where', fieldPath, opStr, value });

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

export type Or<T extends CollectionSchema> = { kind: 'or'; filters: FilterExpression<T>[] };
export type And<T extends CollectionSchema> = { kind: 'and'; filters: FilterExpression<T>[] };

export const or = <T extends CollectionSchema>(...filters: FilterExpression<T>[]): Or<T> => ({
  kind: 'or',
  filters,
});
export const and = <T extends CollectionSchema>(...filters: FilterExpression<T>[]): And<T> => ({
  kind: 'and',
  filters,
});
