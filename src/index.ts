import { type Static, TObject, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  AggregateField,
  DocumentReference,
  Timestamp,
  getFirestore,
} from 'firebase-admin/firestore';
import { Prettify } from './util.js';

const schema = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
  z: Type.Number({
    maximum: 3,
    minimum: 1,
  }),
  foo: Type.Union([Type.Literal('foo'), Type.Literal('bar')]),
});

type Test = Static<typeof schema>;

const parsed = Value.Parse(schema, {});

const db = getFirestore();

export type Collection<T extends Document = Document> = {
  readonly name: string;
  readonly schema: T;
};

export const users = {
  name: 'TestCollection',
  schema: { name: string, age: number },
} as const satisfies Collection;

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

export type Document = {
  [key: string]:
    | number
    | string
    | null
    | Timestamp
    | DocumentReference
    | Document[]
    | Record<string, Document>;
};

const q = db.collection('hoge').withConverter().limit(1).where('a').orderBy().select().get();
const subq = db
  .collectionGroup('hoge')
  .aggregate({
    foo: AggregateField.count(),
  })
  .get();
const a = subq.get().then((a) => a.data().foo);

export const list = <T extends Collection>(collection: T, filter?: FilterOptions<T>): Query<T> =>
  new Query();
export const get = <T extends Collection>(id: string): Query<T> => new Query();
export const getMulti = <T extends Collection>(ids: string[]): Query<T> => new Query();

export type JoinByKeyOptions<T extends Collection, As extends string> = {
  key: (fields: Static<T['schema']>) => unknown;
  as: As;
};

export type JoinByConditionOptions<T extends Collection, U extends Query, As extends string> = {
  left: (fields: Static<T['schema']>) => unknown;
  right: (fields: Static<U['collection']['schema']>) => unknown;
  as: As;
};

export class Query<
  T extends Collection = Collection,
  Joined extends Record<string, Collection | Query> = {},
> {
  constructor(
    readonly collection: T,
    readonly joined?: Joined,
  ) {}

  joinByKey<U extends Collection, As extends string>(
    collection: U,
    options: JoinByKeyOptions<T, As>,
  ): Query<T, Prettify<Joined & Record<As, U>>> {}

  joinByField<U extends Query, As extends string>(
    query: U,
    options: JoinByConditionOptions<T, U, As>,
  ): Query<T, Prettify<Joined & Record<As, U>>> {}
}

const q = list(posts, { where: (v) => v.title, limit: 3 })
  .joinByKey(users, {
    key: (post) => post.userId,
    as: 'author',
  })
  .joinByField(list(comments), {
    left: (post) => post.userId,
    right: (comment) => comment.userId,
    as: 'comments',
  });
