import { describe, expectTypeOf, it } from 'vitest';
import type { FilterOperand } from './query.js';

describe('query', () => {
  it('FilterOperand', () => {
    // TODO more test cases
    expectTypeOf<FilterOperand<number, '>'>>().toEqualTypeOf<number>();
    expectTypeOf<FilterOperand<number, 'in'>>().toEqualTypeOf<never>();

    expectTypeOf<FilterOperand<number | null, '>'>>().toEqualTypeOf<number | null>();

    // array
    expectTypeOf<FilterOperand<string[], '=='>>().toEqualTypeOf<string[]>();
    expectTypeOf<FilterOperand<string[], 'in'>>().toEqualTypeOf<string>();
    expectTypeOf<FilterOperand<string[], 'not-in'>>().toEqualTypeOf<string>();
    expectTypeOf<FilterOperand<string[], 'array-contains'>>().toEqualTypeOf<string>();
    expectTypeOf<FilterOperand<string[], 'array-contains-any'>>().toEqualTypeOf<string[]>();

    // tuple
    expectTypeOf<FilterOperand<[number, 'a' | 'b'], '=='>>().toEqualTypeOf<[number, 'a' | 'b']>();
    expectTypeOf<FilterOperand<[number, 'a' | 'b'], 'in'>>().toEqualTypeOf<number | 'a' | 'b'>();
    expectTypeOf<FilterOperand<[number, 'a' | 'b'], 'not-in'>>().toEqualTypeOf<
      number | 'a' | 'b'
    >();
    expectTypeOf<FilterOperand<[number, 'a' | 'b'], 'array-contains'>>().toEqualTypeOf<
      number | 'a' | 'b'
    >();
    expectTypeOf<FilterOperand<[number, 'a' | 'b'], 'array-contains-any'>>().toEqualTypeOf<
      (number | 'a' | 'b')[]
    >();
  });
});
