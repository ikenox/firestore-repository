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
import { Prettify } from './util.js';

const db = getFirestore();

export type Document = {
  [key: string]: ValueType;
};

export type ValueType = number | string | null | Timestamp | DocumentReference | ValueType[] | Map;
export type Map = { [K in string]: ValueType };

type TypedFieldPath<T extends Document> = {
  [K in keyof T & string]: `${K}` | `${K}.${ValuePaths<T[K]>}`;
}[keyof T & string];
type ValuePaths<T extends ValueType> = T extends Map
  ? {
      [K in keyof T & string]: `${K}` | `${K}.${ValuePaths<T[K]>}`;
    }[T & string]
  : never;

export class TypedQuery<DbModelType extends Document = Document, AppModelType = DbModelType> {
  constructor(readonly inner: Query<AppModelType, DbModelType>) {}

  where(filter: Filter): TypedQuery<DbModelType, AppModelType>;
  where<T extends AppModelType>(
    fieldPath: T,
    opStr: WhereFilterOp,
    value: AppModelType[T], // TODO change type per operator
  ): TypedQuery<DbModelType, AppModelType>;
  where<T extends keyof AppModelType>(
    fieldPathOrFilter: Filter | T,
    opStr?: WhereFilterOp,
    value?: AppModelType[T],
  ): TypedQuery<DbModelType, AppModelType> {
    if (fieldPathOrFilter instanceof Filter) {
      return new TypedQuery(this.inner.where(fieldPathOrFilter));
    }
    return new TypedQuery(this.inner.where(fieldPathOrFilter, opStr, value));
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
  AppModelType extends Document = DbModelType,
> extends TypedQuery<DbModelType, AppModelType> {}

export const collection = <DbModel extends Document = never>(
  name: string,
): TypedCollectionReference<DbModel> => new TypedQuery<DbModel>(name);

const users = collection<{
  userId: string;
  message: string;
  someData: { kind: 'a'; value: number } | { kind: 'b'; value: 456 };
}>('Users');

const res = users.$where('someData', '>', { kind: 'a', value: 213 }).$select('userId');
res.get().then((a) => a.docs.map((a) => a.data()));

export class Collection<DbModel extends Document> {
  constructor(readonly name: string) {}
}

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
