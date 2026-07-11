import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  bool,
  type BoolType,
  bytes,
  double,
  geoPoint,
  int64,
  literal,
  nullType,
  string,
  timestamp,
} from '../schema.js';
import {
  and,
  BinaryFunction,
  constant,
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

  it('infers a constant descriptor from the runtime value', () => {
    // Oracle-both-sides per ConstantTypeOf branch: the runtime descriptor and
    // the type-level inference must agree.
    const cases = [
      [constant(null), nullType()],
      [constant(new Date('2024-01-01T00:00:00Z')), timestamp()],
      [constant(new Uint8Array([1])), bytes()],
      [constant('x'), string()],
      [constant(2), double()],
      [constant(2.5), double()],
      [constant(true), bool()],
      [constant({ latitude: 1, longitude: 2 }), geoPoint()],
    ] as const;
    for (const [c, oracle] of cases) {
      expect(c.type).toStrictEqual(oracle);
    }
    expectTypeOf(constant(null).type).toEqualTypeOf(nullType());
    expectTypeOf(constant(new Date()).type).toEqualTypeOf(timestamp());
    expectTypeOf(constant(new Uint8Array([1])).type).toEqualTypeOf(bytes());
    expectTypeOf(constant('x').type).toEqualTypeOf(string());
    expectTypeOf(constant(2).type).toEqualTypeOf(double());
    expectTypeOf(constant(true).type).toEqualTypeOf(bool());
    expectTypeOf(constant({ latitude: 1, longitude: 2 }).type).toEqualTypeOf(geoPoint());

    // Composite values are not constants (they get dedicated constructors).
    // @ts-expect-error -- arrays are not a ConstantValue
    constant([1, 2]);
    // @ts-expect-error -- plain objects other than GeoPoint are not a ConstantValue
    constant({ a: 1 });
  });

  it('comparisons unify within a value domain', () => {
    // String domain: a literal-typed field against a plain string constant.
    equal(field(literal('male', 'female'), 'gender'), constant('male'));
    // Number domain: numeric literals / int64 / double / number constants mix.
    lessThan(field(literal(1, 2, 3), 'level'), constant(2));
    greaterThan(field(int64(), 'count'), constant(2.5));
    // Other domains fall back to exact same-T.
    equal(field(timestamp(), 'at'), constant(new Date()));
    equal(field(bool(), 'flag'), constant(false));
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
