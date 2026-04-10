import { ArrayRemove, ArrayUnion, Increment, serverOperation, ServerTimestamp } from './schema.js';

export const arrayRemove = <T>(...values: T[]): ArrayRemove<T> => ({
  [serverOperation]: 'arrayRemove',
  values,
});
export const arrayUnion = <T>(...values: T[]): ArrayUnion<T> => ({
  [serverOperation]: 'arrayUnion',
  values,
});
export const serverTimestamp = (): ServerTimestamp => ({ [serverOperation]: 'serverTimestamp' });
export const increment = (amount: number): Increment => ({
  [serverOperation]: 'increment',
  amount,
});
