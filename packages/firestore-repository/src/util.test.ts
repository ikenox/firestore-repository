import { describe, expect, expectTypeOf, it } from 'vitest';
import { assertNever, type Equal } from './util.js';

describe('util', () => {
  it('assertNever', () => {
    // biome-ignore lint/plugin/no-type-assertion: testing assertNever requires casting to never
    expect(() => assertNever(123 as never)).toThrowError('Unreachable code reached with: 123');
  });

  it('IsNumber', () => {
    expectTypeOf<Equal<number, number>>().toEqualTypeOf<true>();
    expectTypeOf<Equal<number, 123>>().toEqualTypeOf<false>();
    expectTypeOf<Equal<number, number | string>>().toEqualTypeOf<false>();
  });
});
