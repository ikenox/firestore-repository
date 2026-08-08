import { ParentDocRef } from './repository.js';
import {
  type ArrayType,
  array,
  type Collection,
  type DocumentSchema,
  type DocFieldPath,
  type FieldType,
  type FieldTypeOfPath,
  type FieldValue,
  type RootCollection,
  type SubCollection,
} from './schema.js';
import { assertNever } from './util.js';

/**
 * A universal query definition: a {@link QuerySource} plus the constraints
 * applied to it.
 *
 * A query is ITSELF a source, which is what makes extending one
 * (`query(existing, limit(5))`) an ordinary call rather than a separate input
 * form — the same relationship the SDK has, where `query()` accepts a
 * `CollectionReference` or another `Query` alike.
 */
export type Query<T extends Collection = Collection> = {
  kind: 'query';
  source: QuerySource<T>;
  constraints: QueryConstraint<T['schema']>[];
};

/**
 * Where a query's rows come from — a single collection instance, a collection
 * group, or another query.
 *
 * Deliberately built by the three factories below rather than accepted as an
 * object literal shaped per collection flavor. A literal would have to say
 * "`parent` is required for a subcollection and absent for a root collection"
 * as a CONDITIONAL type, and a conditional over an unresolved type parameter
 * never resolves: TypeScript then demands a value assignable to BOTH branches,
 * which no literal satisfies. That made every generic helper —
 * `<T extends RootCollection>(c: T) => query(...)` — impossible to write. Each
 * factory instead has a fixed arity, so nothing needs deferring.
 *
 * The member shapes mirror the pipeline's {@link InputStage} of the same names.
 */
export type QuerySource<T extends Collection = Collection> =
  | CollectionSource<T>
  | CollectionGroupSource<T>
  | Query<T>;

/** A single collection instance; `parent` locates it when it is a subcollection. */
export type CollectionSource<T extends Collection = Collection> = {
  kind: 'collection';
  collection: T;
  parent: ParentDocRef<T>;
};

/** Every instance of a collection across the database, regardless of parent. */
export type CollectionGroupSource<T extends Collection = Collection> = {
  kind: 'collectionGroup';
  collection: T;
};

/** A root collection, which has no parent document to locate it. */
export const collection = <T extends RootCollection>(def: T): CollectionSource<T> => ({
  kind: 'collection',
  collection: def,
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a root collection's `parent` is `[]`, which the compiler cannot reduce `ParentDocRef<T>` to over an unresolved `T`
  parent: [] as ParentDocRef<T>,
});

/** One instance of a subcollection, located by its parent document ids. */
export const subcollection = <T extends SubCollection>(
  def: T,
  parent: ParentDocRef<T>,
): CollectionSource<T> => ({ kind: 'collection', collection: def, parent });

/** Every instance of a collection across the database, regardless of parent. */
export const collectionGroup = <T extends Collection>(def: T): CollectionGroupSource<T> => ({
  kind: 'collectionGroup',
  collection: def,
});

/**
 * Builds a query over a source. Passing an existing {@link Query} extends it —
 * a query is a source (see {@link QuerySource}).
 */
export const query = <T extends Collection>(
  source: QuerySource<T>,
  ...constraints: QueryConstraint<T['schema']>[]
): Query<T> => ({ kind: 'query', source, constraints });

/**
 * The `orderBy` field paths a source is ordered by, in the order an executor
 * applies them — an extended query contributes its own ordering first.
 *
 * Cursor values pair with that ordering POSITIONALLY: `startAfter(a, b)` means
 * "after `a` in the first ordered field and `b` in the second". Nothing on a
 * cursor value itself says which field it belongs to, so this list is what
 * tells an executor which field's descriptor to encode each value with — a
 * reference cursor has to reach Firestore as a reference, exactly as a filter
 * operand does.
 *
 * There is no implicit trailing slot: Firestore requires exactly as many
 * cursor values as `orderBy` clauses, so ordering by the document key needs an
 * explicit `orderBy('__name__')` (probed).
 */
export const orderByPaths = <T extends Collection>(
  source: QuerySource<T>,
): DocFieldPath<T['schema']>[] => {
  switch (source.kind) {
    case 'collection':
    case 'collectionGroup':
      return [];
    case 'query':
      return [
        ...orderByPaths(source.source),
        ...source.constraints.filter(isOrderBy).map((constraint) => constraint.field),
      ];
    default:
      return assertNever(source);
  }
};

/** Narrows a constraint to an `orderBy`; the predicate is inferred, and so checked. */
const isOrderBy = <T extends DocumentSchema>(constraint: QueryConstraint<T>) =>
  constraint.kind === 'orderBy';

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
  field: DocFieldPath<T>;
  direction?: 'asc' | 'desc' | undefined;
};
/** Creates an orderBy constraint */
export const orderBy = <T extends DocumentSchema>(
  field: DocFieldPath<T>,
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
  Path extends DocFieldPath<Schema> = DocFieldPath<Schema>,
  Op extends WhereFilterOp = WhereFilterOp,
> = {
  kind: 'fieldValueCondition';
  fieldPath: Path;
  opStr: Op;
  value: FilterOperandValue<Schema, Path, Op>;
};

export type FilterOperandValue<
  Schema extends DocumentSchema,
  Path extends DocFieldPath<Schema> = DocFieldPath<Schema>,
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
export const eq = <T extends DocumentSchema, Path extends DocFieldPath<T>>(
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
export const ne = <T extends DocumentSchema, Path extends DocFieldPath<T>>(
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
export const lt = <T extends DocumentSchema, Path extends DocFieldPath<T>>(
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
export const lte = <T extends DocumentSchema, Path extends DocFieldPath<T>>(
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
export const gt = <T extends DocumentSchema, Path extends DocFieldPath<T>>(
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
export const gte = <T extends DocumentSchema, Path extends DocFieldPath<T>>(
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
export const arrayContains = <T extends DocumentSchema, Path extends DocFieldPath<T>>(
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
export const arrayContainsAny = <T extends DocumentSchema, Path extends DocFieldPath<T>>(
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
export const inArray = <T extends DocumentSchema, Path extends DocFieldPath<T>>(
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
export const notIn = <T extends DocumentSchema, Path extends DocFieldPath<T>>(
  fieldPath: Path,
  value: FilterOperandValue<T, Path, 'not-in'>,
): FieldValueCondition<T, Path, 'not-in'> => fieldValueCondition(fieldPath, 'not-in', value);

const fieldValueCondition = <
  Schema extends DocumentSchema,
  Path extends DocFieldPath<Schema>,
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
 * Runtime counterpart of {@link FilterOperand} (same operator mapping):
 * resolves the `FieldType` describing a single operand of a filter condition
 * on a field — the field's own type for comparisons, a list of it for
 * `in`/`not-in`, the array's element type for `array-contains(-any)`.
 */
export const filterOperand = (fieldType: FieldType, opStr: WhereFilterOp): FieldType => {
  switch (opStr) {
    case '<':
    case '<=':
    case '==':
    case '!=':
    case '>=':
    case '>':
      return fieldType;
    case 'in':
    case 'not-in':
      return array(fieldType);
    case 'array-contains':
    case 'array-contains-any': {
      if (fieldType.type !== 'array') {
        throw new Error(`operator "${opStr}" requires an array field`);
      }
      return opStr === 'array-contains' ? fieldType.dynamicPart : array(fieldType.dynamicPart);
    }
    default:
      return assertNever(opStr);
  }
};

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
