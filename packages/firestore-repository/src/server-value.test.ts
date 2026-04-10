import { describe, expect, it } from 'vitest';

import { serverOperation } from './schema.js';
import { arrayRemove, arrayUnion, increment, serverTimestamp } from './server-value.js';

describe('server-value', () => {
  it('serverTimestamp', () => {
    expect(serverTimestamp()).toStrictEqual({ [serverOperation]: 'serverTimestamp' });
  });

  it('increment', () => {
    expect(increment(5)).toStrictEqual({ [serverOperation]: 'increment', amount: 5 });
  });

  it('arrayUnion', () => {
    expect(arrayUnion(1, 2, 3)).toStrictEqual({
      [serverOperation]: 'arrayUnion',
      values: [1, 2, 3],
    });
  });

  it('arrayRemove', () => {
    expect(arrayRemove('a', 'b')).toStrictEqual({
      [serverOperation]: 'arrayRemove',
      values: ['a', 'b'],
    });
  });
});
