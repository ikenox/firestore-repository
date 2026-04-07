import { describe, expectTypeOf, it } from 'vitest';

import { authorsCollection, postsCollection } from './__test__/specification.js';
import { type FilterOperand, limit, orderBy, query } from './query.js';
import { ArrayType, Int64Type, NullType, StringType, UnionType } from './schema.js';

describe('query', () => {
  describe('query function argument', () => {
    it('root collection', () => {
      query({ collection: authorsCollection });
      query({ collection: authorsCollection, group: false });
      query({ collection: authorsCollection }, orderBy('rank'), limit(1));

      // collection group
      query({ collection: authorsCollection, group: true });
      query({ collection: authorsCollection, group: true });
      query({ collection: authorsCollection, group: true }, orderBy('rank'), limit(1));
    });

    it('subcollection', () => {
      query({ collection: postsCollection, parent: ['123'] as const });
      query(
        { collection: postsCollection, parent: ['123'] as const },
        orderBy('postedAt'),
        limit(1),
      );
      // @ts-expect-error parent is required for subcollection
      query({ collection: postsCollection });
      // @ts-expect-error parent is required for subcollection
      query({ collection: postsCollection, group: false });

      // collection group
      query({ collection: postsCollection, group: true });
      query({ collection: postsCollection, group: true });
      query({ collection: postsCollection, group: true }, orderBy('postedAt'), limit(1));
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
});
