import {
  type FirestoreEnvironment,
  type QueryResultMetadata,
  rawQuerySnapshot,
} from './repository.js';

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

/**
 * Assigns a non-enumerable metadata field to the target object
 */
export const addQueryResultMetadata = <T, Env extends FirestoreEnvironment>(
  target: T,
  querySnapshot: Env['querySnapshot'],
): T & QueryResultMetadata<Env> => {
  Object.defineProperty(target, rawQuerySnapshot, { value: querySnapshot, enumerable: false });
  return target as T & QueryResultMetadata<Env>;
};
