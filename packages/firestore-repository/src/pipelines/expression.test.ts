import { describe, expect, expectTypeOf, it } from 'vitest';

import { bool, type BoolType, double, int64, string } from '../schema.js';
import {
  and,
  BinaryFunction,
  equal,
  field,
  greaterThan,
  greaterThanOrEqual,
  lessThan,
  not,
  notEqual,
  or,
  UnaryFunction,
  VariadicFunction,
} from './expression.js';

describe('expression factories', () => {
  const name = field(string(), 'name');
  const rank = field(double(), 'rank');
  const count = field(int64(), 'count');
  const flag = field(bool(), 'flag');

  it('comparisons accept same-typed operands and mixed numerics', () => {
    equal(name, name);
    notEqual(rank, count); // Int64 and Double mix
    lessThan(count, rank);
    greaterThanOrEqual(rank, rank);
    expectTypeOf(greaterThan(rank, count)).toEqualTypeOf<BinaryFunction<BoolType>>();
  });

  it('comparisons reject cross-group operands', () => {
    // @ts-expect-error -- string vs double
    equal(name, rank);
    // @ts-expect-error -- bool vs double
    lessThan(flag, rank);
  });

  it('and / or / not compose boolean expressions only', () => {
    and(flag, equal(name, name));
    or(equal(rank, count), flag, not(flag));

    // @ts-expect-error -- a string expression is not a condition
    and(flag, name);
    // @ts-expect-error -- a double expression is not a condition
    not(rank);
    // @ts-expect-error -- `and` requires at least two conditions
    and(flag);
  });

  it('builds shape-grouped nodes with typed payloads', () => {
    const cmp = lessThan(rank, count);
    expect(cmp.kind).toBe('binaryFunction');
    expect(cmp.name).toBe('lessThan');
    expect(cmp.left).toBe(rank);
    expect(cmp.right).toBe(count);

    const neg = not(flag);
    expect(neg.kind).toBe('unaryFunction');
    expect(neg.operand).toBe(flag);
    expectTypeOf(neg).toEqualTypeOf<UnaryFunction<BoolType>>();

    const both = and(flag, cmp, neg);
    expect(both.kind).toBe('variadicFunction');
    expect(both.operands).toStrictEqual([flag, cmp, neg]);
    expectTypeOf(both).toEqualTypeOf<VariadicFunction<BoolType>>();
  });
});
