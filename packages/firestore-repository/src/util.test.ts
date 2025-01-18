import { describe, expect, expectTypeOf, it } from 'vitest';
import { type Equal, assertNever } from './util.js';

describe('util', () => {
  it('assertNever', () => {
    expect(() => assertNever(123 as never)).toThrowError('This code should be unreached but: 123');
  });

  it('IsNumber', () => {
    expectTypeOf<Equal<number, number>>().toEqualTypeOf<true>();
    expectTypeOf<Equal<number, 123>>().toEqualTypeOf<false>();
    expectTypeOf<Equal<number, number | string>>().toEqualTypeOf<false>();
  });
});
