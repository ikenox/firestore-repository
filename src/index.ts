import { type Static, Type } from '@sinclair/typebox';
import {
  AggregateField,
  CollectionReference,
  DocumentReference,
  Filter,
  OrderByDirection,
  Query,
  Timestamp,
  WhereFilterOp,
  getFirestore,
} from 'firebase-admin/firestore';

const db = getFirestore();

/**
 * Document type of collection.
 */
export type Document = {
  [key: string]: ValueType;
};

/**
 * Value type of collection field.
 */
export type ValueType = number | string | null | Timestamp | DocumentReference | ValueType[] | Map;
export type Map = { [K in string]: ValueType };

/**
 * A valid path to a field in the collection.
 */
type TypedFieldPath<T extends Document> =
  | {
      [K in keyof T & string]: `${K}` | `${K}.${ValuePath<T[K]>}`;
    }[keyof T & string]
  // A special field name of document ID
  | '__name__';

/**
 * Nested field path of a map field.
 */
type ValuePath<T extends ValueType> = T extends Map
  ? { [K in keyof T & string]: `${K}` | `${K}.${ValuePath<T[K]>}` }[keyof T & string]
  : never;

export class TypedQuery<DbModelType extends Document = Document> {
  constructor(readonly inner: Query) {}

  where(filter: Filter): TypedQuery<DbModelType>;
  where<T extends TypedFieldPath<DbModelType>>(
    fieldPath: T,
    opStr: WhereFilterOp,
    value: DbModelType[T], // TODO change type per operator
  ): TypedQuery<DbModelType>;
  where<T extends TypedFieldPath<DbModelType>>(
    fieldPathOrFilter: Filter | T,
    opStr?: WhereFilterOp,
    value?: DbModelType[T],
  ): TypedQuery<DbModelType> {
    if (fieldPathOrFilter instanceof Filter) {
      return new TypedQuery(this.inner.where(fieldPathOrFilter));
    }
    return new TypedQuery(this.inner.where(fieldPathOrFilter, opStr!, value));
  }

  orderBy<T extends keyof AppModelType>(
    fieldPath: T,
    directionStr?: OrderByDirection,
  ): TypedQuery<DbModelType, AppModelType> {
    return new TypedQuery<DbModelType, AppModelType>(this.inner.orderBy(fieldPath, directionStr));
  }

  limit(limit: number): TypedQuery<DbModelType, AppModelType> {
    return new TypedQuery<DbModelType, AppModelType>(this.inner.limit(limit));
  }
}

export class TypedCollectionReference<
  DbModelType extends Document = Document,
> extends TypedQuery<DbModelType> {}

export const collection = <DbModel extends Document = never>(
  name: string,
): TypedCollectionReference<DbModel> => new TypedCollectionReference<DbModel>(name);

const users = collection<{
  userId: string;
  message: string;
  someData: { kind: 'a'; value: number } | { kind: 'b'; value: 456; foobar: { hoge: 123 } };
}>('Users');

const res = users.where('__name__', '>', { kind: 'a', value: 213 });

export const users: Collection<{
  userId: string;
  message: string;
  someData: {
    kind: 'a';
    value: 123;
  };
}> = {
  name: 'TestCollection',
};

export const comments = {
  name: 'TestCollection',
  schema: Type.Object({
    userId: Type.String(),
    message: Type.String(),
  }),
} as const satisfies Collection;

export const posts = {
  name: 'TestCollection',
  schema: Type.Object({
    userId: Type.String(),
    title: Type.String(),
  }),
} as const satisfies Collection;

export type Condition = {};
export type FilterOptions<T extends Collection> = {
  where?: (fields: Static<T['schema']>) => Condition;
  limit?: number;
};

const subq = db
  .collectionGroup('hoge')
  .aggregate({
    foo: AggregateField.count(),
  })
  .get();
