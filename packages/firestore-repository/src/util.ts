/**
 * Receives and returns a `never` value.
 * This is mainly used for exhaustiveness checking in switch statements.
 */
export const assertNever = (x: never): never => {
  throw new Error(`Unreachable code reached with: ${x}`);
};

export const throwTypeMismatchError = (
  expected: { constructor: { name: string } },
  got: { constructor: { name: string } },
): never => {
  throw new TypeError(`Expected type ${expected.constructor.name} but got ${got.constructor.name}`);
};

/**
 * Checks type-level equality
 */
export type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

/**
 * Converts a tuple type to a tuple of strings with the same length
 * @example ['a', 'b'] -> [string, string]
 */
export type ToStringTuple<T extends unknown[]> = {
  [K in keyof T]: string;
};
