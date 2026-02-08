/**
 * Receives and returns `never` value
 * This is mainly used for exhaustiveness check of a switch statement
 */
export const assertNever = (x: never): never => {
  throw new Error(`Unreachable code reached with: ${x}`);
};

/**
 * Check type-level equality
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
