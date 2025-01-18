import { describe, expectTypeOf, it } from 'vitest';
import { authorsCollection, postsCollection } from './__test__/specification.js';
import { type FilterOperand, limit, orderBy, query } from './query.js';

describe('query', () => {
  describe('query function argument', () => {
    it('root collection', () => {
      // root collection
      query(authorsCollection);
      query(authorsCollection, orderBy('rank'), limit(1));
      // pass parent id explicitly
      query({ collection: authorsCollection, parent: {} });
    });

    it('subcollection', () => {
      // subcollection
      // @ts-expect-error cannot pass subcollection directly to first argument
      query(postsCollection);
      // instead, pass parent collection and parentId
      query({ collection: postsCollection, parent: { authorId: '123' } });
      query(
        { collection: postsCollection, parent: { authorId: '123' } },
        orderBy('postedAt'),
        limit(1),
      );
    });
  });

  it('FilterOperand', () => {
    expectTypeOf<FilterOperand<number, '<'>>().toEqualTypeOf<number>();
    expectTypeOf<FilterOperand<number, '<='>>().toEqualTypeOf<number>();
    expectTypeOf<FilterOperand<number, '=='>>().toEqualTypeOf<number>();
    expectTypeOf<FilterOperand<number, '!='>>().toEqualTypeOf<number>();
    expectTypeOf<FilterOperand<number, '>='>>().toEqualTypeOf<number>();
    expectTypeOf<FilterOperand<number, '>'>>().toEqualTypeOf<number>();
    // cannot apply array operator for non-array value
    expectTypeOf<FilterOperand<number, 'in'>>().toEqualTypeOf<number[]>();
    expectTypeOf<FilterOperand<number, 'not-in'>>().toEqualTypeOf<number[]>();
    expectTypeOf<FilterOperand<number, 'array-contains'>>().toEqualTypeOf<never>();
    expectTypeOf<FilterOperand<number, 'array-contains-any'>>().toEqualTypeOf<never>();

    // nullable value
    expectTypeOf<FilterOperand<number | null, '=='>>().toEqualTypeOf<number | null>();
    expectTypeOf<FilterOperand<number | null, '>'>>().toEqualTypeOf<number | null>();

    // array
    expectTypeOf<FilterOperand<string[], '=='>>().toEqualTypeOf<string[]>();
    expectTypeOf<FilterOperand<string[], '!='>>().toEqualTypeOf<string[]>();
    expectTypeOf<FilterOperand<string[], 'array-contains'>>().toEqualTypeOf<string>();
    expectTypeOf<FilterOperand<string[], 'array-contains-any'>>().toEqualTypeOf<string[]>();

    // tuple
    expectTypeOf<FilterOperand<[number, 'a' | 'b'], '=='>>().toEqualTypeOf<[number, 'a' | 'b']>();
    expectTypeOf<FilterOperand<[number, 'a' | 'b'], '!='>>().toEqualTypeOf<[number, 'a' | 'b']>();
    expectTypeOf<FilterOperand<[number, 'a' | 'b'], 'in'>>().toEqualTypeOf<[number, 'a' | 'b'][]>();
    expectTypeOf<FilterOperand<[number, 'a' | 'b'], 'not-in'>>().toEqualTypeOf<
      [number, 'a' | 'b'][]
    >();
    expectTypeOf<FilterOperand<[number, 'a' | 'b'], 'array-contains'>>().toEqualTypeOf<
      number | 'a' | 'b'
    >();
    expectTypeOf<FilterOperand<[number, 'a' | 'b'], 'array-contains-any'>>().toEqualTypeOf<
      (number | 'a' | 'b')[]
    >();
  });
});
