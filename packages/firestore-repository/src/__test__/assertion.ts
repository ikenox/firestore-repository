import { expect } from 'vitest';

/**
 * Exact mutual type equality (the invariance trick — the same discrimination
 * `expectTypeOf(...).toEqualTypeOf` uses: two `<T>() => T extends X ? 1 : 2`
 * function signatures are assignable only when `A` and `B` are the SAME type,
 * so a mere sub/supertype relation is rejected).
 */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/**
 * `toStrictEqual` plus a compile-time EXACT type-equality guard on its two
 * arguments: the runtime value claim and the static type claim are pinned
 * TOGETHER, so the fragile two-line `toStrictEqual` + `expectTypeOf` pairing
 * (either half forgettable) becomes a single call. Use it wherever the static
 * type of the asserted value is part of the claim — above all for type
 * descriptors, whose type-level and runtime forms come from separate
 * mechanisms (the typed-overload / loose-implementation bridges).
 *
 * Expected values are whole values: the exact-equality guard rejects
 * asymmetric matchers (`expect.any`, ...) by construction, which is correct
 * here — descriptor expectations are never partial. See
 * docs/coding-guideline.md §"Test assertions".
 */
export const expectTypedStrictEqual = <A, B>(
  actual: A,
  expected: B & (Equals<A, B> extends true ? unknown : never),
): void => {
  expect(actual).toStrictEqual(expected);
};
