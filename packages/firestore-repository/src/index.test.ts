import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type DbModel,
  type Id,
  type MapArray,
  type Model,
  type ParentId,
  type Timestamp,
  type ValueType,
  type WriteModel,
  type WriteValue,
  collection,
  collectionPath,
  docPath,
  id,
  parentPath,
} from './index.js';
import type { FieldPath } from './query.js';

describe('CollectionSchema', () => {
  // root collection
  const authorsCollection = collection({
    name: 'Authors',
    data: {
      from: (data: {
        authorId: string;
        name: string;
        registeredAt: Timestamp;
      }) => ({
        ...data,
        registeredAt: data.registeredAt.toDate(),
      }),
      to: (data) => data,
    },
    id: id('authorId'),
  });

  // subcollection
  const postsCollection = collection({
    name: 'Posts',
    data: {
      from: (data: {
        postId: number;
        title: string;
        postedAt: Timestamp;
        authorId: string;
      }) => ({
        ...data,
        postedAt: data.postedAt.toDate(),
      }),
      to: (data) => data,
    },
    id: id('postId'),
    parentPath: parentPath(authorsCollection, 'authorId'),
  });

  type Authors = typeof authorsCollection;
  type Posts = typeof postsCollection;

  describe('schema types', () => {
    it('root collection', () => {
      expectTypeOf<Id<Authors>>().toEqualTypeOf<{ authorId: string }>();
      expectTypeOf<ParentId<Authors>>().toEqualTypeOf<Record<never, never>>();
      expectTypeOf<Model<Authors>>().toEqualTypeOf<{
        authorId: string;
        name: string;
        registeredAt: Date;
      }>();
      expectTypeOf<DbModel<Authors>>().toEqualTypeOf<{
        authorId: string;
        name: string;
        registeredAt: Timestamp;
      }>();
    });

    it('subcollection', () => {
      expectTypeOf<Id<Posts>>().toEqualTypeOf<{ postId: number; authorId: string }>();
      expectTypeOf<ParentId<Posts>>().toEqualTypeOf<{ authorId: string }>();
      expectTypeOf<Model<Posts>>().toEqualTypeOf<{
        postId: number;
        authorId: string;
        title: string;
        postedAt: Date;
      }>();
      expectTypeOf<DbModel<Posts>>().toEqualTypeOf<{
        postId: number;
        authorId: string;
        title: string;
        postedAt: Timestamp;
      }>();
    });
  });

  it('write model', () => {
    expectTypeOf<WriteValue<string>>().toEqualTypeOf<string>();
    expectTypeOf<WriteValue<{ a: { b: 123 } }>>().toEqualTypeOf<{ a: { b: 123 } }>();
    expectTypeOf<WriteValue<Timestamp>>().toEqualTypeOf<Date | Timestamp>();
    expectTypeOf<WriteValue<{ a: { b: Timestamp } }>>().toEqualTypeOf<{
      a: { b: Date | Timestamp };
    }>();
    // prevent deep type instantiation
    expectTypeOf<WriteValue<ValueType>>().toEqualTypeOf<WriteValue<ValueType>>();

    expectTypeOf<MapArray<[number, Timestamp]>>().toEqualTypeOf<[number, Timestamp | Date]>();
    expectTypeOf<MapArray<number[]>>().toEqualTypeOf<number[]>();
    expectTypeOf<MapArray<Timestamp[]>>().toEqualTypeOf<(Timestamp | Date)[]>();
    expectTypeOf<MapArray<ValueType[]>>().toEqualTypeOf<WriteValue<ValueType>[]>();

    expectTypeOf<WriteModel<{ a: string; b: Timestamp }>>().toEqualTypeOf<{
      a: string;
      b: Timestamp | Date;
    }>();
    expectTypeOf<
      WriteModel<{
        a: string;
        b: { c: Timestamp; d: string };
        e: number[];
        f: { g: Timestamp }[];
        h: { i: 'foo'; j: string } | { i: 'bar'; j: number };
      }>
    >().toEqualTypeOf<{
      a: string;
      b: { c: Timestamp | Date; d: string };
      e: number[];
      f: { g: Timestamp | Date }[];
      h: { i: 'foo'; j: string } | { i: 'bar'; j: number };
    }>();
  });

  describe('FieldPath', () => {
    it('simple', () => {
      const c = collection({
        name: 'Posts',
        data: {
          from: (data: { a: number; b: string; c: string[] }) => data,
          to: (data) => data,
        },
        id: id('a'),
      });
      expectTypeOf<FieldPath<typeof c>>().toEqualTypeOf<'a' | 'b' | 'c' | '__name__'>();
    });
    it('complex', () => {
      const c = collection({
        name: 'Posts',
        data: {
          from: (data: { a: { b: string; c: { d: number; e: { f: string }[] } } }) => data,
          to: (data) => data,
        },
        id: id('a'),
      });
      expectTypeOf<FieldPath<typeof c>>().toEqualTypeOf<
        'a' | 'a.b' | 'a.c' | 'a.c.d' | 'a.c.e' | '__name__'
      >();
    });
  });

  it('docPath', () => {
    expect(docPath(authorsCollection, { authorId: 'abc' })).toBe('Authors/abc');
    expect(docPath(postsCollection, { postId: 123, authorId: 'abc' })).toBe(
      'Authors/abc/Posts/123',
    );
  });

  it('collectionPath', () => {
    expect(collectionPath(authorsCollection, {})).toBe('Authors');
    expect(collectionPath(postsCollection, { authorId: 'abc' })).toBe('Authors/abc/Posts');
  });
});
