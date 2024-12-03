import type { AggregateSpec, Aggregated, Query, QueryConstraint } from './query.js';

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
   * TODO improve interface query(parentId).constraint(...)
   */
  query: (
    parentIdOrQuery:
      | ParentId<T>
      | Query<T, Env>
      // parentId can be omitted for root collection
      | ([keyof ParentId<T>] extends [never] ? QueryConstraint<Query<T, Env>> : never),
    ...constraints: QueryConstraint<Query<T, Env>>[]
  ) => Query<T, Env>;

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

export const queryTag: unique symbol = Symbol();

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
export type DocumentData = {
  [key: string]: ValueType;
};

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
export type MapValue = { [K in string]: ValueType };

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
