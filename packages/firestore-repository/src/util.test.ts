import { describe, expect, expectTypeOf, it } from 'vitest';

import { assertNever, type Equal, type ToStringTuple } from './util.js';

describe('util', () => {
  it('assertNever', () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- testing assertNever requires casting to never
    expect(() => assertNever(123 as never)).toThrowError('Unreachable code reached with: 123');
  });

  it('IsNumber', () => {
    expectTypeOf<Equal<number, number>>().toEqualTypeOf<true>();
    expectTypeOf<Equal<number, 123>>().toEqualTypeOf<false>();
    expectTypeOf<Equal<number, number | string>>().toEqualTypeOf<false>();
  });

  it('ToStringTuple', () => {
    expectTypeOf<ToStringTuple<[]>>().toEqualTypeOf<[]>();
    expectTypeOf<ToStringTuple<[number]>>().toEqualTypeOf<[string]>();
    expectTypeOf<ToStringTuple<[number, boolean]>>().toEqualTypeOf<[string, string]>();
    expectTypeOf<ToStringTuple<[boolean, symbol, never, 'a']>>().toEqualTypeOf<
      [string, string, string, string]
    >();
    expectTypeOf<ToStringTuple<number[]>>().toEqualTypeOf<string[]>();
  });
});
