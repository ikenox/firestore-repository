import { describe, expect, expectTypeOf, it } from 'vitest';
import { randomString } from './__test__/util.js';
import { type FirestoreEnvironment, rawQuerySnapshot } from './repository.js';
import { type Equal, addQueryResultMetadata, assertNever } from './util.js';

describe('util', () => {
  it('assertNever', () => {
    expect(() => assertNever(123 as never)).toThrowError('This code should be unreached but: 123');
  });

  it('IsNumber', () => {
    expectTypeOf<Equal<number, number>>().toEqualTypeOf<true>();
    expectTypeOf<Equal<number, 123>>().toEqualTypeOf<false>();
    expectTypeOf<Equal<number, number | string>>().toEqualTypeOf<false>();
  });

  it('addRawQueryResult', () => {
    const a = [1, 2, 3];
    const b = randomString();

    const result = addQueryResultMetadata<typeof a, FirestoreEnvironment>(a, b);
    expect(result).toStrictEqual(a);
    expect(result[rawQuerySnapshot]).toBe(b);
  });
});
