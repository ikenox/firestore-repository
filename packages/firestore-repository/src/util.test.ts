import { describe, expect, it } from 'vitest';
import { assertNever } from './util.js';

describe('util', () => {
  it('assertNever', () => {
    expect(() => assertNever(123 as never)).toThrowError('This code should be unreached but: 123');
  });
});
