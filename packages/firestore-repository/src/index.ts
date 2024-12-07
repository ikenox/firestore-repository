export const collection = <
  DbModel extends DocumentData = DocumentData,
  AppModel extends Record<string, unknown> = Record<string, unknown>,
  IdKeys extends (keyof AppModel)[] = (keyof AppModel)[],
  ParentIdKeys extends (keyof AppModel)[] = [],
>(
  schema: CollectionSchema<DbModel, AppModel, IdKeys, ParentIdKeys>,
) => schema;

export const id = <AppModel extends Record<string, unknown>, IdKey extends keyof AppModel>(
  key: IdKey,
): IdSchema<AppModel, [IdKey]> => ({
  keys: [key],
  to: (data) => `${data[key]}`,
});

export const parentPath = <AppModel extends Record<string, unknown>, IdKey extends keyof AppModel>(
  parent: CollectionSchema,
  key: IdKey,
): ParentPathSchema<AppModel, [IdKey]> => ({
  keys: [key],
  to: (data) => `${parent.name}/${data[key]}`,
});

/**
 * A definition of firestore collection
 */
export type CollectionSchema<
  DbModel extends DocumentData = DocumentData,
  AppModel extends Record<string, unknown> = Record<string, unknown>,
  IdKeys extends (keyof AppModel)[] = (keyof AppModel)[],
  ParentIdKeys extends (keyof AppModel)[] = (keyof AppModel)[],
> = {
  name: string;
  data: {
    from(data: DbModel): AppModel;
    to(data: NoInfer<AppModel>): WriteModel<NoInfer<DbModel>>;
  };
  id: IdSchema<NoInfer<AppModel>, IdKeys>;
  parentPath?: ParentPathSchema<NoInfer<AppModel>, ParentIdKeys> | undefined;
};

export type IdSchema<
  AppModel extends Record<string, unknown>,
  IdKeys extends (keyof AppModel)[],
> = {
  keys: IdKeys;
  to(id: Pick<AppModel, IdKeys[number]>): string;
};

export type ParentPathSchema<
  AppModel extends Record<string, unknown>,
  ParentIdKeys extends (keyof AppModel)[],
> = { keys: ParentIdKeys; to(id: Pick<AppModel, ParentIdKeys[number]>): string };

export type Id<T extends CollectionSchema> = T extends CollectionSchema<
  DocumentData,
  infer AppModel,
  infer IdKeys,
  infer ParentIdKeys
>
  ? Pick<AppModel, IdKeys[number] | ParentIdKeys[number]>
  : never;

export type ParentId<T extends CollectionSchema> = T extends CollectionSchema<
  DocumentData,
  infer AppModel,
  infer _IdKeys,
  infer ParentIdKeys
>
  ? Pick<AppModel, ParentIdKeys[number]>
  : never;

export type Model<T extends CollectionSchema> = T extends CollectionSchema<
  DocumentData,
  infer AppModel,
  infer _IdKeys,
  infer _ParentIdKeys
>
  ? AppModel
  : never;

export type DbModel<T extends CollectionSchema> = T extends CollectionSchema<
  infer DbModel,
  infer _AppModel,
  infer _IdKeys,
  infer _ParentIdKeys
>
  ? DbModel
  : never;

/**
 * Returns a path of the document
 */
export const docPath = <T extends CollectionSchema>(schema: T, id: Id<T>): string => {
  const docId = schema.id.to(id);
  return `${collectionPath(schema, id)}/${docId}`;
};

/**
 * Returns a path of the collection
 */
export const collectionPath = <T extends CollectionSchema>(schema: T, id: ParentId<T>): string => {
  return schema.parentPath ? `${schema.parentPath.to(id)}/${schema.name}` : schema.name;
};

export const queryTag: unique symbol = Symbol();

/**
 * Query representation
 */
export type Query<
  T extends CollectionSchema = CollectionSchema,
  Env extends FirestoreEnvironment = FirestoreEnvironment,
> = {
  [queryTag]: true;
  collection: T;
  inner: Env['query'];
};

/**
 * Query constraint
 */
export type QueryConstraint<T extends Query> = (query: T['inner']) => T['inner'];
export type OrderBy<Env extends FirestoreEnvironment = FirestoreEnvironment> = <
  T extends CollectionSchema,
>(
  field: FieldPath<DbModel<T>>,
  direction?: 'asc' | 'desc',
) => QueryConstraint<Query<T, Env>>;
export type Limit<Env extends FirestoreEnvironment = FirestoreEnvironment> = <
  T extends CollectionSchema,
>(
  limit: number,
) => QueryConstraint<Query<T, Env>>;
export type LimitToLast<Env extends FirestoreEnvironment = FirestoreEnvironment> = <
  T extends CollectionSchema,
>(
  limit: number,
) => QueryConstraint<Query<T, Env>>;
export type Where<Env extends FirestoreEnvironment = FirestoreEnvironment> = <
  T extends CollectionSchema,
>(
  filter: FilterExpression<T>,
) => QueryConstraint<Query<T, Env>>;
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

export type Or<T extends CollectionSchema> = { kind: 'or'; filters: FilterExpression<T>[] };
export type And<T extends CollectionSchema> = { kind: 'and'; filters: FilterExpression<T>[] };
export const condition = <
  T extends CollectionSchema,
  Path extends FieldPath<DbModel<T>>,
  Op extends WhereFilterOp,
>(
  fieldPath: Path,
  opStr: Op,
  value: WriteValue<FilterOperand<FieldValue<DbModel<T>, Path>, Op>>,
): UnaryCondition<T, Path> => ({ kind: 'where', fieldPath, opStr, value });
export const or = <T extends CollectionSchema>(...filters: FilterExpression<T>[]): Or<T> => ({
  kind: 'or',
  filters,
});
export const and = <T extends CollectionSchema>(...filters: FilterExpression<T>[]): And<T> => ({
  kind: 'and',
  filters,
});
export type Aggregated<T extends AggregateSpec> = {
  [K in keyof T]: number;
};
export type AggregateSpec<T extends CollectionSchema = CollectionSchema> = Record<
  string,
  AggregateMethod<T>
>;
export type AggregateMethod<T extends CollectionSchema> = Count | Sum<T> | Average<T>;
export type Count = { kind: 'count' };
export type Sum<T extends CollectionSchema> = { kind: 'sum'; path: FieldPath<DbModel<T>> };
export type Average<T extends CollectionSchema> = { kind: 'average'; path: FieldPath<DbModel<T>> };
export const sum = <T extends CollectionSchema>(path: FieldPath<DbModel<T>>): Sum<T> => ({
  kind: 'sum',
  path,
});
export const average = <T extends CollectionSchema>(path: FieldPath<DbModel<T>>): Average<T> => ({
  kind: 'average',
  path,
});
export const count = (): Count => ({
  kind: 'count',
});
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

/**
 * A universal repository interface
 */
export interface Repository<
  T extends CollectionSchema = CollectionSchema,
  Env extends FirestoreEnvironment = FirestoreEnvironment,
> {
  collection: T;

  /**
   * Get single document by ID
   */
  get: (id: Id<T>, options?: TransactionOption<Env>) => Promise<Model<T> | undefined>;

  /**
   * Listen single document
   */
  getOnSnapshot: (
    id: Id<T>,
    next: (snapshot: Model<T> | undefined) => void,
    error?: (error: Error) => void,
  ) => Unsubscribe;

  /**
   * Returns a documents list of the specified query
   */
  list: (query: Query<T, Env>) => Promise<Model<T>[]>;

  /**
   * Listen documents of the specified query
   */
  listOnSnapshot: (
    query: Query<T, Env>,
    next: (snapshot: Model<T>[]) => void,
    error?: (error: Error) => void,
  ) => Unsubscribe;

  /**
   * Returns an aggregation of the specified query
   */
  aggregate: <T extends CollectionSchema, U extends AggregateSpec<T>>(
    query: Query<T, Env>,
    spec: U,
  ) => Promise<Aggregated<U>>;

  /**
   * Start a query or chaining another query
   */
  query(
    parentIdOrQuery: ParentId<T> | Query<T, Env>,
    ...constraints: QueryConstraint<Query<T, Env>>[]
  ): Query<T, Env>;
  query(
    // parentId can be omitted on root collection
    // TODO type information is dropped when calling
    ...constraints: [keyof ParentId<T>] extends [never] ? QueryConstraint<Query<T, Env>>[] : never
  ): Query<T, Env>;

  /**
   * Start a collection group query
   */
  collectionGroupQuery: (...constraints: QueryConstraint<Query<T, Env>>[]) => Query<T, Env>;

  /**
   * Create or update
   */
  set: (doc: Model<T>, options?: WriteTransactionOption<Env>) => Promise<void>;

  /**
   * Delete a document by ID
   */
  delete: (id: Id<T>, options?: WriteTransactionOption<Env>) => Promise<void>;

  /**
   * Create or update multiple documents
   */
  batchSet: (docs: Model<T>[], options?: WriteTransactionOption<Env>) => Promise<void>;

  /**
   * Delete documents by multiple ID
   */
  batchDelete: (ids: Id<T>[], options?: WriteTransactionOption<Env>) => Promise<void>;
}

/**
 * Platform-specific types
 */
export type FirestoreEnvironment = {
  transaction: unknown;
  writeBatch: unknown;
  query: unknown;
};

export type TransactionOption<T extends FirestoreEnvironment> = { tx?: T['transaction'] };
export type WriteTransactionOption<T extends FirestoreEnvironment> = {
  tx?: T['transaction'] | T['writeBatch'];
};

export type Unsubscribe = () => void;

/**
 * Type of firestore document data
 */
export type DocumentData = MapValue;

/**
 * Type of firestore field value
 */
export type ValueType =
  | number
  | string
  | null
  | Timestamp
  // | DocumentReference
  // | GeoPoint
  | ValueType[]
  | MapValue;
export type Timestamp = { toDate(): Date };
// export type DocumentReference = sdk.DocumentReference | admin.DocumentReference;
// export type GeoPoint = sdk.GeoPoint | admin.GeoPoint;
export type MapValue = { [key: string]: ValueType };

export type FieldPath<T extends DocumentData = DocumentData> =
  | { [K in keyof T & string]: K | `${K}.${ValueFieldPath<T[K]>}` }[keyof T & string]
  | '__name__';
export type ValueFieldPath<T extends ValueType> = T extends MapValue
  ? { [K in keyof T & string]: K | `${K}.${ValueFieldPath<T[K]>}` }[keyof T & string]
  : never;

export type FieldValue<T extends DocumentData, U extends FieldPath<T>> = U extends keyof T
  ? Exclude<T[U], undefined>
  : U extends '__name__'
    ? string
    : U extends `${infer P}.${infer R}`
      ? P extends keyof T
        ? T[P] extends MapValue
          ? FieldValue<T[P], R>
          : T[P]
        : never
      : never;

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

export type WriteModel<T extends DocumentData> = {
  [K in keyof T]: WriteValue<T[K]>;
};
export type WriteValue<T extends ValueType> =
  | (T extends Timestamp ? Date | Timestamp : never)
  | (T extends MapValue ? { [K in keyof T]: WriteValue<T[K]> } : never)
  | (T extends ValueType[] ? MapArray<T> : never)
  | (T extends number | string | null ? T : never);

export type MapArray<T> = T extends [infer A extends ValueType, ...infer B extends ValueType[]]
  ? [WriteValue<A>, ...MapArray<B>]
  : T extends []
    ? []
    : T extends (infer A extends ValueType)[]
      ? WriteValue<A>[]
      : never;

/**
 * A utility method
 */
export const assertNever = (x: never): never => {
  throw new Error(`This code should be unreached but: ${x}`);
};
