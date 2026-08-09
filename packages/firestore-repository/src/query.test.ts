import { describe, expect, expectTypeOf, it } from 'vitest';

import { authorsCollection, postsCollection } from './__test__/specification.js';
import {
  collectionGroup,
  collection,
  type FilterOperand,
  filterOperandTypeOf,
  gte,
  limit,
  orderBy,
  type Query,
  endAt,
  endBefore,
  query,
  startAfter,
  startAt,
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

  // A query has ONE result window, not a sequence of them, so `query` lifts the
  // bounds out of the constraint list — and pairs each of their values with the
  // field it belongs to, which nothing on a value itself says.
  describe('bounds', () => {
    const authors = collection(authorsCollection);

    it('pairs each value with the field at its own position', () => {
      const q = query(authors, orderBy('rank'), orderBy('name'), startAfter(1, 'a'));
      expect(q.start).toStrictEqual({
        kind: 'startAfter',
        cursor: [
          { value: 1, field: 'rank' },
          { value: 'a', field: 'name' },
        ],
      });
    });

    // Firestore rejects this too, but only once the query runs. Refusing it
    // here fails at the mistake, and is what lets every `CursorValue` in a
    // built query carry a field it actually belongs to.
    it('refuses a cursor with nothing to pair against', () => {
      expect(() => query(authors, startAfter(1))).toThrow(/needs an orderBy\(\) to pair with/);
    });

    // Lifting the bound out is what makes this true: it pairs with the query's
    // whole ordering, so where it sat among the arguments stops mattering.
    it('pairs against the whole ordering, wherever the bound was written', () => {
      const before = query(authors, startAfter(1, 'a'), orderBy('rank'), orderBy('name'));
      const after = query(authors, orderBy('rank'), orderBy('name'), startAfter(1, 'a'));
      expect(before.start).toStrictEqual(after.start);
    });

    it('inherits the ordering of an extended query, ahead of its own', () => {
      const base = query(authors, orderBy('rank'));
      expect(query(base, orderBy('name'), startAfter(1, 'a')).start?.cursor).toStrictEqual([
        { value: 1, field: 'rank' },
        { value: 'a', field: 'name' },
      ]);
    });

    it('inherits through more than one level of extension', () => {
      const extended = query(query(authors, orderBy('rank')), orderBy('name'));
      expect(query(extended, startAfter(1, 'a')).start?.cursor).toStrictEqual([
        { value: 1, field: 'rank' },
        { value: 'a', field: 'name' },
      ]);
    });

    it('refuses a cursor longer than the ordering', () => {
      expect(() => query(authors, orderBy('rank'), startAfter(1, 'extra'))).toThrow(
        /cursor of 2 value\(s\) cannot pair with a query ordered by 1 field\(s\)/,
      );
    });

    // Fewer is fine: a cursor may bound a prefix of the ordering.
    it('accepts a cursor shorter than the ordering', () => {
      expect(
        query(authors, orderBy('rank'), orderBy('name'), startAfter(1)).start?.cursor,
      ).toStrictEqual([{ value: 1, field: 'rank' }]);
    });

    // Matching the SDKs, where a second call replaces the first rather than
    // narrowing the window further (probed).
    it('keeps the last bound of each end', () => {
      const q = query(authors, orderBy('rank'), startAfter(1), startAt(2), endBefore(9), endAt(8));
      expect(q.start).toStrictEqual({ kind: 'startAt', cursor: [{ value: 2, field: 'rank' }] });
      expect(q.end).toStrictEqual({ kind: 'endAt', cursor: [{ value: 8, field: 'rank' }] });
    });

    it('has neither bound when none was given', () => {
      const q = query(authors, orderBy('rank'), limit(1));
      expect(q.start).toBeUndefined();
      expect(q.end).toBeUndefined();
      // ...and the list keeps only what is not a bound.
      expect(q.constraints.map(({ kind }) => kind)).toStrictEqual(['orderBy', 'limit']);
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

  it('filterOperandTypeOf (runtime counterpart of FilterOperand)', () => {
    const int = int64();
    expect(filterOperandTypeOf(int, '==')).toStrictEqual(int);
    expect(filterOperandTypeOf(int, '>')).toStrictEqual(int);
    expect(filterOperandTypeOf(int, 'in')).toStrictEqual(array(int));
    expect(filterOperandTypeOf(int, 'not-in')).toStrictEqual(array(int));
    expect(filterOperandTypeOf(array(string()), 'array-contains')).toStrictEqual(string());
    expect(filterOperandTypeOf(array(string()), 'array-contains-any')).toStrictEqual(
      array(string()),
    );
    // type-level never — at runtime an explicit error
    expect(() => filterOperandTypeOf(int, 'array-contains')).toThrow(/requires an array field/);
  });
});
