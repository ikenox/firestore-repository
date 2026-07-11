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
  array,
  map,
  string,
  timestamp,
  union,
  vector,
} from '../schema.js';
import {
  and,
  BinaryFunction,
  constant,
  geoPointValue,
  vectorValue,
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
