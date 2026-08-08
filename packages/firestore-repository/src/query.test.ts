import { describe, expect, expectTypeOf, it } from 'vitest';

import { authorsCollection, postsCollection } from './__test__/specification.js';
import {
  collectionGroup,
  collection,
  type FilterOperand,
  filterOperand,
  gte,
  limit,
  orderBy,
  type Query,
  query,
  subcollection,
  where,
} from './query.js';
import type { ParentDocRef } from './repository.js';
import {
  type ArrayType,
  array,
  type Collection,
  type DoubleType,
  type Int64Type,
  int64,
  type NullType,
  type RootCollection,
  type StringType,
  string,
  type SubCollection,
  type UnionType,
} from './schema.js';

describe('query', () => {
  describe('query source', () => {
    it('root collection', () => {
      query(collection(authorsCollection));
      query(collection(authorsCollection), orderBy('rank'), limit(1));
      // @ts-expect-error a subcollection needs a parent to locate it, so it is not a `collection`
      query(collection(postsCollection));
    });

    it('subcollection', () => {
      query(subcollection(postsCollection, ['123']));
      query(subcollection(postsCollection, ['123']), orderBy('postedAt'), limit(1));
      // @ts-expect-error a root collection has no parent document to locate it
      query(subcollection(authorsCollection, []));
      // @ts-expect-error the parent tuple must match the collection's ancestry
      query(subcollection(postsCollection, ['123', 'extra']));
    });

    it('collection group', () => {
      query(collectionGroup(authorsCollection));
      query(collectionGroup(postsCollection), orderBy('postedAt'), limit(1));
    });

    it('another query, which extends it', () => {
      const base = query(collection(authorsCollection), orderBy('rank'));
      expectTypeOf(query(base, limit(1))).toEqualTypeOf<Query<typeof authorsCollection>>();
    });

    // Why the source is built by fixed-arity factories instead of one object
    // literal shaped per collection flavor. Expressing that shape needs a
    // conditional type, which never resolves over an unresolved type parameter
    // — TypeScript then demands a value assignable to BOTH branches, and no
    // literal is. Every one of these was unwritable before.
    describe('is buildable from a generic helper', () => {
      it('over a root collection', () => {
        const f = <T extends RootCollection>(c: T) => query(collection(c), limit(20));
        expectTypeOf(f(authorsCollection)).toEqualTypeOf<Query<typeof authorsCollection>>();
      });

      it('over a subcollection', () => {
        const f = <T extends SubCollection>(c: T, parent: ParentDocRef<T>) =>
          query(subcollection(c, parent), limit(20));
        expectTypeOf(f(postsCollection, ['123'])).toEqualTypeOf<Query<typeof postsCollection>>();
      });

      it('over any collection', () => {
        const f = <T extends Collection>(c: T) => query(collectionGroup(c), limit(20));
        expectTypeOf(f(postsCollection)).toEqualTypeOf<Query<typeof postsCollection>>();
      });

      it('extending a query it was given', () => {
        const f = <T extends Collection>(q: Query<T>) => query(q, limit(5));
        expectTypeOf(f(query(collectionGroup(postsCollection)))).toEqualTypeOf<
          Query<typeof postsCollection>
        >();
      });

      // Field paths resolve through the constraint too, as long as the helper
      // bounds the schema it reads.
      it('with constraints over the bounded schema', () => {
        const f = <T extends RootCollection<{ rank: DoubleType }>>(c: T, min: number) =>
          query(collection(c), where(gte('rank', min)), orderBy('rank', 'desc'), limit(20));
        expectTypeOf(f(authorsCollection, 1)).toEqualTypeOf<Query<typeof authorsCollection>>();
      });
    });
  });

  it('FilterOperand', () => {
    expectTypeOf<FilterOperand<Int64Type, '<'>>().toEqualTypeOf<Int64Type>();
    expectTypeOf<FilterOperand<Int64Type, '<='>>().toEqualTypeOf<Int64Type>();
    expectTypeOf<FilterOperand<Int64Type, '=='>>().toEqualTypeOf<Int64Type>();
    expectTypeOf<FilterOperand<Int64Type, '!='>>().toEqualTypeOf<Int64Type>();
    expectTypeOf<FilterOperand<Int64Type, '>='>>().toEqualTypeOf<Int64Type>();
    expectTypeOf<FilterOperand<Int64Type, '>'>>().toEqualTypeOf<Int64Type>();
    expectTypeOf<FilterOperand<Int64Type, 'in'>>().toEqualTypeOf<ArrayType<Int64Type>>();
    expectTypeOf<FilterOperand<Int64Type, 'not-in'>>().toEqualTypeOf<ArrayType<Int64Type>>();
    // cannot apply array operator for non-array value
    expectTypeOf<FilterOperand<Int64Type, 'array-contains'>>().toEqualTypeOf<never>();
    expectTypeOf<FilterOperand<Int64Type, 'array-contains-any'>>().toEqualTypeOf<never>();

    // nullable value
    type NullableInt = UnionType<[Int64Type, NullType]>;
    expectTypeOf<FilterOperand<NullableInt, '=='>>().toEqualTypeOf<NullableInt>();
    expectTypeOf<FilterOperand<NullableInt, '>'>>().toEqualTypeOf<NullableInt>();

    // array
    expectTypeOf<FilterOperand<ArrayType<StringType>, '=='>>().toEqualTypeOf<
      ArrayType<StringType>
    >();
    expectTypeOf<FilterOperand<ArrayType<StringType>, '!='>>().toEqualTypeOf<
      ArrayType<StringType>
    >();
    expectTypeOf<
      FilterOperand<ArrayType<StringType>, 'array-contains'>
    >().toEqualTypeOf<StringType>();
    expectTypeOf<FilterOperand<ArrayType<StringType>, 'array-contains-any'>>().toEqualTypeOf<
      ArrayType<StringType>
    >();
  });

  it('filterOperand (runtime counterpart of FilterOperand)', () => {
    const int = int64();
    expect(filterOperand(int, '==')).toStrictEqual(int);
    expect(filterOperand(int, '>')).toStrictEqual(int);
    expect(filterOperand(int, 'in')).toStrictEqual(array(int));
    expect(filterOperand(int, 'not-in')).toStrictEqual(array(int));
    expect(filterOperand(array(string()), 'array-contains')).toStrictEqual(string());
    expect(filterOperand(array(string()), 'array-contains-any')).toStrictEqual(array(string()));
    // type-level never — at runtime an explicit error
    expect(() => filterOperand(int, 'array-contains')).toThrow(/requires an array field/);
  });
});
