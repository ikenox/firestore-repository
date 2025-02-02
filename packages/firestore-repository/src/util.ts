/**
 * Receives and returns `never` value
 * This is mainly used for exhaustiveness check of a switch statement
 */
export const assertNever = (x: never): never => {
  throw new Error(`This code should be unreached but: ${x}`);
};

/**
 * Check type-level equality
 */
export type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
  ? true
  : false;
