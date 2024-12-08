import type { FieldPath, FieldValue, ValueType, WriteValue } from './document.js';
import {
  type CollectionSchema,
  type DbModel,
  type IsSubCollection,
  type ParentId,
  collectionSchemaTag,
} from './schema.js';

export class Query<T extends CollectionSchema = CollectionSchema> {
  constructor(
    readonly base:
      | { kind: 'collection'; collection: T; parentId: ParentId<T> }
      | { kind: 'collectionGroup'; collection: T }
      | { kind: 'extends'; query: Query<T> },
    constraints?: QueryConstraint<T>[],
  ) {}
}

export const query = <T extends CollectionSchema>(
  base: (IsSubCollection<T> extends true ? { collection: T; parent: ParentId<T> } : T) | Query<T>,
  ...constraints: QueryConstraint<T>[]
): Query<T> => {
  if (base instanceof Query) {
    // extends another query
    return new Query({ kind: 'extends', query: base }, constraints);
  }
  if (collectionSchemaTag in base) {
    // root collection
    return new Query(
      { kind: 'collection', collection: base as T, parentId: {} as ParentId<T> },
      constraints,
    );
  }
  // subcollection
  return new Query(
    { kind: 'collection', collection: base.collection, parentId: base.parent },
    constraints,
  );
};

// TODO disable for root collection
export const collectionGroupQuery = <T extends CollectionSchema>(
  collection: T,
  ...constraints: QueryConstraint<T>[]
): Query<T> => {
  return new Query({ kind: 'collectionGroup', collection }, constraints);
};

/**
 * Query constraint
 */
export type QueryConstraint<T extends CollectionSchema> =
  | Where<T>
  | OrderBy<T>
  | Limit
  | LimitToLast;

export const queryConstraintKind: unique symbol = Symbol();

export type Where<T extends CollectionSchema> = {
  [queryConstraintKind]: 'where';
  filter: FilterExpression<T>;
};
export const where = <T extends CollectionSchema>(filter: FilterExpression<T>): Where<T> => ({
  [queryConstraintKind]: 'where',
  filter,
});

export type OrderBy<T extends CollectionSchema> = {
  [queryConstraintKind]: 'orderBy';
  field: FieldPath<DbModel<T>>;
  direction?: 'asc' | 'desc' | undefined;
};
export const orderBy = <T extends CollectionSchema>(
  field: FieldPath<DbModel<T>>,
  direction?: 'asc' | 'desc' | undefined,
): OrderBy<T> => ({ [queryConstraintKind]: 'orderBy', field, direction });

export type Limit = {
  [queryConstraintKind]: 'limit';
  limit: number;
};
export const limit = (limit: number): Limit => ({ [queryConstraintKind]: 'limit', limit });

export type LimitToLast = {
  [queryConstraintKind]: 'limitToLast';
  limit: number;
};
export const limitToLast = (limit: number): LimitToLast => ({
  [queryConstraintKind]: 'limitToLast',
  limit,
});

// TODO
// startAt
// startAfter
// endBefore
// endAt
// findNearest
// and
// or
// select
// aggregate

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

export const condition = <
  T extends CollectionSchema,
  Path extends FieldPath<DbModel<T>>,
  Op extends WhereFilterOp,
>(
  fieldPath: Path,
  opStr: Op,
  value: WriteValue<FilterOperand<FieldValue<DbModel<T>, Path>, Op>>,
): UnaryCondition<T, Path> => ({ kind: 'where', fieldPath, opStr, value });

export type FilterOperand<T extends ValueType, U extends WhereFilterOp> = {
  // TODO accept only possible type for each operands
  '<': T;
  '<=': T;
  '==': T;
  '!=': T;
  '>=': T;
  '>': T;
  'array-contains': T extends (infer A)[] ? A : never;
  in: T extends (infer A)[] ? A : never;
  'not-in': T extends (infer A)[] ? A : never;
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
