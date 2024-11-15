import { type Static, Type } from '@sinclair/typebox';
import {
  AggregateField,
  DocumentReference,
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

export type ValueType =
  | number
  | string
  | null
  | Timestamp
  | DocumentReference
  | ValueType[]
  | { [K in string]: ValueType };

export class TypedQuery<
  DbModelType extends Document = Document,
  AppModelType extends Document = DbModelType,
> extends Query<DbModelType, AppModelType> {
  $where<T extends keyof AppModelType>(
    fieldPath: T,
    opStr: WhereFilterOp,
    value: AppModelType[T], // TODO change type per operator
  ): TypedQuery<DbModelType, AppModelType> {}

  $select<T extends (keyof AppModelType)[]>(
    ...fields: T
  ): TypedQuery<DbModelType, Pick<AppModelType, T>> {}
}

export const collection = <DbModel extends Document = never>(name: string): TypedQuery<DbModel> =>
  new TypedQuery<DbModel>(name);

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
