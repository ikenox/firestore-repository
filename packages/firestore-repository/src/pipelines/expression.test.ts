import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  array,
  bool,
  type BoolType,
  bytes,
  double,
  geoPoint,
  int64,
  literal,
  map,
  nullable,
  nullType,
  string,
  type StringType,
  timestamp,
  union,
  vector,
} from '../schema.js';
import {
  and,
  BinaryFunction,
  Constant,
  constant,
  equal,
  type ExpressionWithAlias,
  Field,
  field,
  geoPointValue,
  greaterThan,
  greaterThanOrEqual,
  lessThan,
  lessThanOrEqual,
  not,
  notEqual,
  or,
  UnaryFunction,
  VariadicFunction,
  vectorValue,
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
      [geoPointValue(1, 2), geoPoint()],
      [vectorValue([0.5, 0.25]), vector()],
      [constant([1, 2, 3]), array(double())],
      [constant(['a', 'b']), array(string())],
      [constant({ n: 1, s: 'x' }), map({ n: double(), s: string() })],
      [constant({ nested: { xs: [true] } }), map({ nested: map({ xs: array(bool()) }) })],
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
    expectTypeOf(geoPointValue(1, 2).type).toEqualTypeOf(geoPoint());
    expectTypeOf(vectorValue([0.5, 0.25]).type).toEqualTypeOf(vector());
    expectTypeOf(constant([1, 2, 3]).type).toEqualTypeOf(array(double()));
    expectTypeOf(constant({ n: 1, s: 'x' }).type).toEqualTypeOf(map({ n: double(), s: string() }));

    // A plain object is always a MAP constant — geopoints and vectors have no
    // JS representation of their own, hence the dedicated constructors.
    expectTypeOf(constant({ latitude: 1, longitude: 2 }).type).toEqualTypeOf(
      map({ latitude: double(), longitude: double() }),
    );

    // Heterogeneous arrays: element descriptors dedup in tuple order and
    // become a UnionType (matching Firestore's heterogeneous arrays).
    const mixed = constant([1, 'a', 2, true]);
    const mixedOracle = array(union(double(), string(), bool()));
    expect(mixed.type).toStrictEqual(mixedOracle);
    expectTypeOf(mixed.type).toEqualTypeOf(mixedOracle);

    // Geopoint / vector nodes double as composite leaves (Firestore values
    // hold them at any depth; they have no plain-JS representation, so the
    // explicit nodes stand in).
    const withNodes = constant({ spot: geoPointValue(1, 3), embedding: [vectorValue([1, 2])] });
    const withNodesOracle = map({ spot: geoPoint(), embedding: array(vector()) });
    expect(withNodes.type).toStrictEqual(withNodesOracle);
    expectTypeOf(withNodes.type).toEqualTypeOf(withNodesOracle);

    const nestedMixed = constant({ deep: [1, 'a'] });
    const nestedMixedOracle = map({ deep: array(union(double(), string())) });
    expect(nestedMixed.type).toStrictEqual(nestedMixedOracle);
    expectTypeOf(nestedMixed.type).toEqualTypeOf(nestedMixedOracle);
    expect(() =>
      // @ts-expect-error -- an empty array literal has no element to infer from
      constant([]),
    ).toThrow('constant arrays must not be empty');
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
    // Whole-instance comparison: `toStrictEqual` checks the constructor and
    // every own field, so a payload field added later cannot silently escape.
    const cmp = lessThan(rank, count);
    expect(cmp).toStrictEqual(new BinaryFunction('lessThan', bool(), rank, count));

    const neg = not(flag);
    expect(neg).toStrictEqual(new UnaryFunction('not', bool(), flag));
    expectTypeOf(neg).toEqualTypeOf<UnaryFunction<BoolType>>();

    const both = and(flag, cmp, neg);
    expect(both).toStrictEqual(new VariadicFunction('and', bool(), [flag, cmp, neg]));
    expectTypeOf(both).toEqualTypeOf<VariadicFunction<BoolType>>();
  });
});

describe('aliasing (.as)', () => {
  it('binds every node kind to an alias as plain data', () => {
    const f = field(string(), 'name');
    expect(f.as('x')).toStrictEqual({ expression: f, alias: 'x' });

    const c = constant(1);
    expect(c.as('n')).toStrictEqual({ expression: c, alias: 'n' });

    const g = geoPointValue(1, 2);
    expect(g.as('g')).toStrictEqual({ expression: g, alias: 'g' });

    const v = vectorValue([1]);
    expect(v.as('v')).toStrictEqual({ expression: v, alias: 'v' });

    const cmp = equal(field(double(), 'rank'), constant(1));
    expect(cmp.as('b')).toStrictEqual({ expression: cmp, alias: 'b' });
  });

  it('preserves literal types: the alias and the field path', () => {
    const aliased = field(string(), 'a.b').as('x');
    expectTypeOf(aliased.alias).toEqualTypeOf<'x'>();
    expectTypeOf(aliased.expression).toEqualTypeOf<Field<StringType, 'a.b'>>();
    // The pair satisfies the selection-facing shape.
    const asSelection: ExpressionWithAlias<StringType, 'x'> = aliased;
    expect(asSelection.alias).toBe('x');
  });
});

describe('constant edges', () => {
  it('non-finite and signed-zero numbers are doubles', () => {
    for (const n of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0]) {
      expect(constant(n).type).toStrictEqual(double());
    }
  });

  it('Buffer is bytes (it is a Uint8Array)', () => {
    expect(constant(Buffer.from([1, 2])).type).toStrictEqual(bytes());
  });

  it('an empty map is valid (unlike an empty array)', () => {
    const empty = constant({});
    const oracle = map({});
    expect(empty.type).toStrictEqual(oracle);
    expectTypeOf(empty.type).toEqualTypeOf(oracle);
  });

  it('undefined is rejected on both layers', () => {
    expect(() =>
      // @ts-expect-error -- undefined is not a ConstantValue
      constant(undefined),
    ).toThrow();
  });

  it('only geopoint/vector nodes are composite leaves — no other expressions', () => {
    // @ts-expect-error -- a Field expression is not a constant value
    constant({ x: field(string(), 'name') });
    // @ts-expect-error -- a computed expression is not a constant value
    constant({ x: equal(field(string(), 'n'), constant('a')) });
  });

  it('the constructor is sealed; the factory is sugar for Constant.of', () => {
    // @ts-expect-error -- the constructor is private; construction goes through Constant.of
    new Constant(double(), 1);
    expect(Constant.of(5)).toStrictEqual(constant(5));
  });

  it('dedups array element descriptors ignoring map key order', () => {
    const c = constant([
      { a: 1, b: 2 },
      { b: 3, a: 4 },
    ]);
    const oracle = array(map({ a: double(), b: double() }));
    expect(c.type).toStrictEqual(oracle);
    expectTypeOf(c.type).toEqualTypeOf(oracle);
  });

  it('vectorValue copies its input defensively', () => {
    const source = [1, 2];
    const v = vectorValue(source);
    source.push(3);
    expect(v.values).toStrictEqual([1, 2]);
  });
});

describe('comparison operators (table-driven over all six)', () => {
  const rank = field(double(), 'rank');
  const count = field(int64(), 'count');
  const name = field(string(), 'name');

  const table = [
    ['equal', equal],
    ['notEqual', notEqual],
    ['lessThan', lessThan],
    ['lessThanOrEqual', lessThanOrEqual],
    ['greaterThan', greaterThan],
    ['greaterThanOrEqual', greaterThanOrEqual],
  ] as const;

  it('every comparison shares the same operand domains', () => {
    for (const [fnName, cmp] of table) {
      // number domain (int64 / double / numeric literal / number constant)
      expect(cmp(rank, count)).toStrictEqual(new BinaryFunction(fnName, bool(), rank, count));
      expect(cmp(field(literal(1, 2), 'lv'), constant(2)).name).toBe(fnName);
      // string domain (plain / literal)
      expect(cmp(field(literal('x', 'y'), 's'), constant('x')).name).toBe(fnName);
      // same-T pairs for the remaining groups
      expect(cmp(field(timestamp(), 'at'), constant(new Date(0))).name).toBe(fnName);
      expect(cmp(field(bytes(), 'raw'), constant(new Uint8Array([1]))).name).toBe(fnName);
      expect(cmp(field(geoPoint(), 'geo'), geoPointValue(1, 2)).name).toBe(fnName);
      expect(cmp(field(vector(), 'vec'), vectorValue([1])).name).toBe(fnName);
      expect(cmp(field(nullType(), 'z'), constant(null)).name).toBe(fnName);
      // function operands nest (bool same-T)
      expect(cmp(equal(rank, count), constant(true)).name).toBe(fnName);
    }
  });

  it('every comparison rejects cross-group operands', () => {
    // @ts-expect-error -- string vs number
    equal(name, rank);
    // @ts-expect-error -- string vs number
    notEqual(name, rank);
    // @ts-expect-error -- string vs number
    lessThan(name, rank);
    // @ts-expect-error -- string vs number
    lessThanOrEqual(name, rank);
    // @ts-expect-error -- string vs number
    greaterThan(name, rank);
    // @ts-expect-error -- string vs number
    greaterThanOrEqual(name, rank);
  });

  it('same-T requires identical descriptors — no union-vs-narrow widening', () => {
    // Empirically disproved a stale comment: the same-T fallback does NOT
    // unify a union-typed operand with a narrower one. NOTE: this is the
    // CURRENT contract, and deliberately changes with the planned
    // overlap-based compatibility (see the expressions plan) — a union with
    // a shared member SHOULD compare.
    const u1 = field(union(string(), double()), 'u1');
    const u2 = field(union(string(), double()), 'u2');
    equal(u1, u2); // identical union descriptors: ok
    // @ts-expect-error -- a narrower operand does not widen into the union
    equal(u1, field(string(), 's'));
  });

  it('pins the current nullable contract (to change with null-tolerant domains)', () => {
    const ns = field(nullable(string()), 'ns');
    // Identical nullable descriptors unify via same-T...
    equal(ns, ns);
    // ...but a plain string constant does not (strict domains today).
    // @ts-expect-error -- nullable strings are outside the string domain
    equal(ns, constant('x'));
  });
});

describe('logical operator edges', () => {
  const flag = field(bool(), 'flag');

  it('takes many operands and nests', () => {
    const cmp = equal(field(double(), 'rank'), constant(1));
    const five = and(flag, cmp, not(flag), or(flag, cmp), not(not(flag)));
    expect(five.operands).toHaveLength(5);
    expect(five.name).toBe('and');
  });

  it('pins the current exact-BoolType contract for conditions', () => {
    // A literal(true, false) field is a LiteralType, not BoolType — rejected
    // today (to change with the planned BooleanValued domain).
    // @ts-expect-error -- literal booleans are not Expression<BoolType>
    and(flag, field(literal(true, false), 'lit'));
  });
});
