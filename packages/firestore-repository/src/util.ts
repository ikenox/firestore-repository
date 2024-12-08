/**
 * A utility method
 */
export const assertNever = (x: never): never => {
  throw new Error(`This code should be unreached but: ${x}`);
};
