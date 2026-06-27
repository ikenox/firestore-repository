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

const hasServerOp = (v: unknown, op: string): boolean =>
  v != null && typeof v === 'object' && Reflect.get(v, serverOperation) === op;

export const isArrayRemove = (v: unknown): v is ArrayRemove<unknown> =>
  hasServerOp(v, 'arrayRemove');
export const isArrayUnion = (v: unknown): v is ArrayUnion<unknown> => hasServerOp(v, 'arrayUnion');
export const isServerTimestamp = (v: unknown): v is ServerTimestamp =>
  hasServerOp(v, 'serverTimestamp');
export const isIncrement = (v: unknown): v is Increment => hasServerOp(v, 'increment');
