/**
 * Receives and returns `never` value
 * This is mainly used for exhaustiveness check of a switch statement
 */
export const assertNever = (x: never): never => {
  throw new Error(`This code should be unreached but: ${x}`);
};
