import { describe, expect, it } from 'vitest';

import { serverOperation } from './schema.js';
import {
  arrayRemove,
  arrayUnion,
  increment,
  isArrayRemove,
  isArrayUnion,
  isIncrement,
  isServerTimestamp,
  serverTimestamp,
} from './server-value.js';

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

describe('server operation guards', () => {
  // Each guard only checks the `serverOperation` brand, so it must accept its own
  // sentinel and reject every other sentinel as well as arbitrary non-sentinel values.
  const guards = [
    { name: 'isIncrement', guard: isIncrement, own: increment(5) },
    { name: 'isServerTimestamp', guard: isServerTimestamp, own: serverTimestamp() },
    { name: 'isArrayUnion', guard: isArrayUnion, own: arrayUnion(1, 2) },
    { name: 'isArrayRemove', guard: isArrayRemove, own: arrayRemove('a', 'b') },
  ];

  // Values that must never be recognized as any server operation.
  const nonSentinels: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['number', 5],
    ['string', 'increment'],
    ['boolean', true],
    ['empty object', {}],
    ['array', [1, 2, 3]],
    ['plain object with amount', { amount: 5 }],
    ['object with unknown op', { [serverOperation]: 'unknownOp' }],
    ['function', () => undefined],
  ];

  for (const { name, guard, own } of guards) {
    describe(name, () => {
      it('returns true for its own sentinel', () => {
        expect(guard(own)).toBe(true);
      });

      it('returns false for other sentinels', () => {
        for (const other of guards) {
          if (other.name !== name) {
            expect(guard(other.own)).toBe(false);
          }
        }
      });

      it.each(nonSentinels)('returns false for %s', (_label, value) => {
        expect(guard(value)).toBe(false);
      });
    });
  }
});
