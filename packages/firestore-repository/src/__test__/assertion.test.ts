import { describe, expect, it } from 'vitest';

import { double, int64, nullable, string } from '../schema.js';
import { expectTypedStrictEqual } from './assertion.js';

describe('expectTypedStrictEqual', () => {
  it('accepts a matching value whose static type is exactly equal', () => {
    expectTypedStrictEqual(string(), string());
    expectTypedStrictEqual(nullable(int64()), nullable(int64()));
    expectTypedStrictEqual('x' as string, 'x' as string);
  });

  // The negatives are COMPILE-TIME claims: the guard must reject them. They are
  // never executed (the values genuinely differ, so the runtime `toStrictEqual`
  // would fail) — an uncalled function type-checks the body without running it.
  it('rejects mismatches at the type level', () => {
    expect(rejectedByTheTypeGuard).toBeTypeOf('function');
  });
});

const rejectedByTheTypeGuard = (): void => {
  // A subtype expected against a supertype actual: the guard is invariant.
  // @ts-expect-error -- int64() is not exactly double()
  expectTypedStrictEqual(double(), int64());
  // A wider expected against a narrower actual is rejected too.
  const narrow = 1 as const;
  // @ts-expect-error -- `number` is not exactly the literal `1`
  expectTypedStrictEqual(narrow, 1 as number);
  // Asymmetric matchers are rejected by construction (not whole values).
  // @ts-expect-error -- expect.any is not a StringType value
  expectTypedStrictEqual(string(), expect.any(Object));
};
