import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  array,
  bool,
  type BoolType,
  bytes,
  docRef,
  double,
  geoPoint,
  int64,
  literal,
  map,
  nullable,
  nullType,
  optional,
  rootCollection,
  string,
  type StringType,
  timestamp,
  union,
  vector,
} from '../schema.js';
import {
  abs,
  add,
  and,
  BinaryFunction,
  byteLength,
  ceil,
  charLength,
  Constant,
  constant,
  divide,
  endsWith,
  equal,
  exp,
  type ExpressionWithAlias,
  Field,
  field,
  floor,
  geoPointValue,
  greaterThan,
  greaterThanOrEqual,
  lessThan,
  lessThanOrEqual,
  ln,
  log10,
  ltrim,
  mod,
  multiply,
  not,
  notEqual,
  NullaryFunction,
  or,
  pow,
  rand,
  round,
  rtrim,
  sqrt,
  startsWith,
  collectionId,
  cosineDistance,
  docRefValue,
  DocRefValue,
  documentId,
  dotProduct,
  euclideanDistance,
  isType,
  like,
  regexContains,
  regexFind,
  regexFindAll,
  regexMatch,
  stringConcat,
  stringContains,
  stringIndexOf,
  stringRepeat,
  stringReplaceAll,
  stringReplaceOne,
  stringReverse,
  substring,
  subtract,
  TernaryFunction,
  type,
  vectorLength,
  toLower,
  toUpper,
  trim,
  trunc,
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

  it('overlap-based compatibility: a union with a shared member compares against a narrower operand', () => {
    const u1 = field(union(string(), double()), 'u1');
    const u2 = field(union(string(), double()), 'u2');
    equal(u1, u2); // identical union descriptors: ok
    equal(u1, field(string(), 's')); // shared 'string' tag: ok
    equal(u1, constant(1)); // shared numeric tags: ok
    // @ts-expect-error -- zero overlap: {string, integer, double} vs timestamp
    equal(u1, field(timestamp(), 'at'));
  });

  it('null is special-cased: nullable operands compare on their NON-NULL overlap', () => {
    const ns = field(nullable(string()), 'ns');
    equal(ns, ns);
    equal(ns, constant('x')); // shared 'string' tag: ok
    // Sharing ONLY 'null' does not make a pair comparable: true only in the
    // both-null corner — almost surely a bug.
    // @ts-expect-error -- the non-null tags (string vs timestamp) have zero overlap
    equal(ns, field(nullable(timestamp()), 'nt'));
    // A PURE null operand is the exception — an is-null check, legal against
    // any nullable operand (either side) ...
    equal(ns, constant(null));
    equal(constant(null), ns);
    equal(constant(null), constant(null));
    // ...and rejected against a never-null one (always false).
    // @ts-expect-error -- 'string' vs 'null' have zero overlap
    equal(field(string(), 's'), constant(null));
    // A plain descriptor overlaps its nullable widening.
    equal(field(string(), 's'), ns);
  });

  it('container tags compare member-wise at every depth (one rule, uniformly)', () => {
    // The single TagSetsComparable rule (null-stripped overlap + the
    // pure-null is-null exception) recurses into array elements and map
    // fields, matching how TS's own === treats nested unions.
    const arr = field(array(string()), 'arr');
    const arrNullable = field(array(nullable(string())), 'arrN');
    equal(arr, arrNullable);
    equal(arrNullable, arr);
    // A shared element tag is enough — neither side needs to include the other.
    equal(field(array(union(string(), double())), 'sd'), arrNullable);
    // An array of pure nulls against a nullable-element array is the nested
    // is-null form.
    equal(field(array(nullType()), 'nulls'), arrNullable);
    // Sharing ONLY null inside the container is not overlap (the nested
    // both-null corner) ...
    // @ts-expect-error -- (string|null)[] vs (double|null)[] share no non-null element tag
    equal(arrNullable, field(array(nullable(double())), 'dn'));
    // ...and pure-null elements against never-null elements stay rejected.
    // @ts-expect-error -- null[] vs string[]: an element is never null
    equal(field(array(nullType()), 'nulls'), arr);
    // Maps: one key set must include the other, shared keys compare
    // member-wise.
    equal(field(map({ a: string() }), 'm'), field(map({ a: nullable(string()) }), 'mn'));
    equal(
      field(map({ a: string() }), 'm'),
      field(map({ a: union(string(), double()), b: bool() }), 'wide'),
    );
    // @ts-expect-error -- disjoint key sets: maps of different shapes never hold equal values
    equal(field(map({ a: string() }), 'm'), field(map({ b: string() }), 'other'));
    // @ts-expect-error -- shared key with disjoint tags
    equal(field(map({ a: string() }), 'm'), field(map({ a: double() }), 'num'));
  });

  it('firestoreType keys the compatibility — pairs whose TS representations collide stay rejected', () => {
    const authors = rootCollection({ name: 'authors', schema: { name: string() } });
    // A reference decodes to string[], a vector to number[], a geopoint to a
    // {latitude, longitude} object — the tag axis keeps them apart from the
    // genuine array/map descriptors sharing those representations.
    // @ts-expect-error -- 'reference' vs array-of-'string'
    equal(field(docRef(authors), 'ref'), field(array(string()), 'tags'));
    // @ts-expect-error -- 'vector' vs array-of-number
    equal(field(vector(), 'vec'), field(array(double()), 'nums'));
    // @ts-expect-error -- 'geopoint' vs the same-shaped map
    equal(field(geoPoint(), 'geo'), field(map({ latitude: double(), longitude: double() }), 'm'));
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

  it("conditions are Valued<'boolean'>: boolean literals and nullable booleans qualify", () => {
    // The condition domain is the firestoreType predicate 'boolean' (null is
    // special-cased inside Valued), not the exact BoolType descriptor: a
    // literal(true, false) field and a nullable(bool()) field are both
    // boolean-valued (a null condition just drops the row — truthy-only
    // semantics).
    and(flag, field(literal(true, false), 'lit'));
    or(flag, field(nullable(bool()), 'nb'));
    not(field(literal(true), 'lt'));
    // @ts-expect-error -- a string field is not boolean-valued
    and(flag, field(string(), 'name'));
    // @ts-expect-error -- a string field is not a condition
    not(field(string(), 'name'));
  });

  it('propagates operand nullability into the result descriptor (Kleene logic)', () => {
    // Probed: and(true, null) is null, and(false, null) is false — Kleene
    // three-valued logic, so a possibly-null operand makes the result
    // possibly null. Oracle-both-sides per operator/operand kind.
    const nullableBool = nullable(bool());

    // All-boolean operands: the result stays a plain BoolType.
    const strict = and(flag, not(flag));
    expect(strict.type).toStrictEqual(bool());
    expectTypeOf(strict.type).toEqualTypeOf(bool());

    // A nullable operand propagates.
    const viaNullable = and(flag, field(nullable(bool()), 'nb'));
    expect(viaNullable.type).toStrictEqual(nullableBool);
    expectTypeOf(viaNullable.type).toEqualTypeOf(nullableBool);

    // An optional (possibly absent) operand counts too: an absent operand
    // flows through functions as null (probed).
    const viaOptional = or(flag, field(optional(bool()), 'ob'));
    expect(viaOptional.type).toStrictEqual(nullableBool);
    expectTypeOf(viaOptional.type).toEqualTypeOf(nullableBool);

    // A boolean literal union containing null counts.
    const viaLiteral = or(flag, field(literal(true, null), 'ln'));
    expect(viaLiteral.type).toStrictEqual(nullableBool);
    expectTypeOf(viaLiteral.type).toEqualTypeOf(nullableBool);

    // not() propagates, and nested nullability flows upward.
    const viaNot = not(field(nullable(bool()), 'nb'));
    expect(viaNot.type).toStrictEqual(nullableBool);
    expectTypeOf(viaNot.type).toEqualTypeOf(nullableBool);
    const nested = and(flag, viaNot);
    expect(nested.type).toStrictEqual(nullableBool);
    expectTypeOf(nested.type).toEqualTypeOf(nullableBool);

    // Comparisons do NOT propagate: they are total (never null), even over
    // nullable operands.
    const cmp = equal(field(nullable(string()), 'ns'), constant(null));
    expect(cmp.type).toStrictEqual(bool());
    expectTypeOf(cmp.type).toEqualTypeOf(bool());
  });
});

describe('arithmetic operators', () => {
  const rank = field(double(), 'rank');
  const count = field(int64(), 'count');

  it('builds shape-grouped nodes across all three arities', () => {
    expect(rand()).toStrictEqual(new NullaryFunction('rand', double()));
    expect(abs(rank)).toStrictEqual(new UnaryFunction('abs', double(), rank));
    expect(add(rank, count)).toStrictEqual(new BinaryFunction('add', double(), rank, count));
  });

  it('every unary function shares the numeric domain and DoubleType result', () => {
    const table = [
      ['abs', abs],
      ['ceil', ceil],
      ['floor', floor],
      ['sqrt', sqrt],
      ['exp', exp],
      ['ln', ln],
      ['log10', log10],
    ] as const;
    for (const [fnName, fn] of table) {
      expect(fn(count)).toStrictEqual(new UnaryFunction(fnName, double(), count));
      expect(fn(field(literal(1, 2), 'lv')).name).toBe(fnName);
    }
    // round/trunc are overloaded (dual-arity), so a union-typed table entry
    // is not callable — exercised individually.
    expect(round(count)).toStrictEqual(new UnaryFunction('round', double(), count));
    expect(trunc(count)).toStrictEqual(new UnaryFunction('trunc', double(), count));
    // @ts-expect-error -- a string operand is not numeric
    abs(field(string(), 'name'));
  });

  it('every binary function shares the numeric domain and DoubleType result', () => {
    const table = [
      ['add', add],
      ['subtract', subtract],
      ['multiply', multiply],
      ['divide', divide],
      ['mod', mod],
      ['pow', pow],
    ] as const;
    for (const [fnName, fn] of table) {
      expect(fn(rank, constant(2))).toStrictEqual(
        new BinaryFunction(fnName, double(), rank, constant(2)),
      );
    }
    // @ts-expect-error -- a string operand is not numeric
    add(field(string(), 'name'), constant(1));
    // @ts-expect-error -- a boolean operand is not numeric
    multiply(rank, field(bool(), 'flag'));
  });

  it('round/trunc are dual-arity: an optional decimal-places operand', () => {
    expect(round(rank, constant(2))).toStrictEqual(
      new BinaryFunction('round', double(), rank, constant(2)),
    );
    expect(trunc(rank, count)).toStrictEqual(new BinaryFunction('trunc', double(), rank, count));
    // @ts-expect-error -- decimal places must be numeric
    round(rank, constant('2'));
  });

  it('propagates operand nullability, and rand (no operands) never does', () => {
    const nullableDouble = nullable(double());
    const viaNullable = add(rank, field(nullable(int64()), 'nc'));
    expect(viaNullable.type).toStrictEqual(nullableDouble);
    expectTypeOf(viaNullable.type).toEqualTypeOf(nullableDouble);
    const viaOptional = sqrt(field(optional(double()), 'od'));
    expect(viaOptional.type).toStrictEqual(nullableDouble);
    expectTypeOf(viaOptional.type).toEqualTypeOf(nullableDouble);
    const viaDecimals = round(rank, field(nullable(int64()), 'nd'));
    expect(viaDecimals.type).toStrictEqual(nullableDouble);
    expectTypeOf(viaDecimals.type).toEqualTypeOf(nullableDouble);
    expectTypeOf(rand().type).toEqualTypeOf(double());
  });
});

describe('string operators', () => {
  const name = field(string(), 'name');
  const gender = field(literal('male', 'female'), 'gender');

  it('transforms return StringType, lengths return Int64Type', () => {
    const table = [
      ['toLower', toLower, string()],
      ['toUpper', toUpper, string()],
      ['stringReverse', stringReverse, string()],
      ['charLength', charLength, int64()],
      ['byteLength', byteLength, int64()],
    ] as const;
    for (const [fnName, fn, resultType] of table) {
      expect(fn(name)).toStrictEqual(new UnaryFunction(fnName, resultType, name));
      // Literal-typed string fields are inside the domain.
      expect(fn(gender).name).toBe(fnName);
    }
    // The trim family is overloaded (dual-arity), so a union-typed table
    // entry is not callable — exercised individually.
    expect(trim(name)).toStrictEqual(new UnaryFunction('trim', string(), name));
    expect(ltrim(name)).toStrictEqual(new UnaryFunction('ltrim', string(), name));
    expect(rtrim(name)).toStrictEqual(new UnaryFunction('rtrim', string(), name));
    expect(trim(gender).name).toBe('trim');
    // @ts-expect-error -- a numeric operand is not a string
    toUpper(field(double(), 'rank'));
  });

  it('trim family is dual-arity: an optional character-set operand', () => {
    expect(trim(name, constant('"'))).toStrictEqual(
      new BinaryFunction('trim', string(), name, constant('"')),
    );
    expect(ltrim(name, constant('x')).name).toBe('ltrim');
    expect(rtrim(name, constant('x')).name).toBe('rtrim');
    // @ts-expect-error -- the character set must be a string
    trim(name, constant(1));
  });

  it('predicates return BoolType but PROPAGATE null (unlike comparisons)', () => {
    const table = [
      ['startsWith', startsWith],
      ['endsWith', endsWith],
      ['stringContains', stringContains],
    ] as const;
    for (const [fnName, fn] of table) {
      expect(fn(name, constant('a'))).toStrictEqual(
        new BinaryFunction(fnName, bool(), name, constant('a')),
      );
      const viaNullable = fn(field(nullable(string()), 'ns'), constant('a'));
      expect(viaNullable.type).toStrictEqual(nullable(bool()));
      expectTypeOf(viaNullable.type).toEqualTypeOf(nullable(bool()));
    }
    // A propagated predicate is still a valid condition (BooleanValued domain).
    and(field(bool(), 'flag'), startsWith(field(nullable(string()), 'ns'), constant('a')));
    // @ts-expect-error -- a numeric operand is not a string
    startsWith(field(double(), 'rank'), constant('a'));
  });

  it('stringConcat takes two or more strings and propagates nullability', () => {
    const c = stringConcat(name, constant('-'), gender);
    expect(c).toStrictEqual(
      new VariadicFunction('stringConcat', string(), [name, constant('-'), gender]),
    );
    expectTypeOf(c.type).toEqualTypeOf(string());
    const viaNullable = stringConcat(name, field(nullable(string()), 'ns'));
    expect(viaNullable.type).toStrictEqual(nullable(string()));
    expectTypeOf(viaNullable.type).toEqualTypeOf(nullable(string()));
    // @ts-expect-error -- stringConcat requires at least two operands
    stringConcat(name);
    // @ts-expect-error -- a numeric operand is not a string
    stringConcat(name, field(double(), 'rank'));
  });

  it('composes: function results feed other functions within their domains', () => {
    // toUpper(name)'s StringType result is a string operand...
    charLength(toUpper(name));
    // ...and charLength's Int64Type result is a numeric operand.
    add(charLength(name), constant(1));
    lessThan(charLength(name), constant(10));
    // @ts-expect-error -- a numeric result is not a string operand
    toUpper(charLength(name));
  });
});

describe('string operators (slice 3)', () => {
  const name = field(string(), 'name');

  it('indexOf / repeat / replace / substring shapes and domains', () => {
    expect(stringIndexOf(name, constant('b'))).toStrictEqual(
      new BinaryFunction('stringIndexOf', int64(), name, constant('b')),
    );
    expect(stringRepeat(name, constant(2))).toStrictEqual(
      new BinaryFunction('stringRepeat', string(), name, constant(2)),
    );
    expect(stringReplaceAll(name, constant('a'), constant('x'))).toStrictEqual(
      new TernaryFunction('stringReplaceAll', string(), name, constant('a'), constant('x')),
    );
    expect(stringReplaceOne(name, constant('a'), constant('x'))).toStrictEqual(
      new TernaryFunction('stringReplaceOne', string(), name, constant('a'), constant('x')),
    );
    // @ts-expect-error -- the repeat count is numeric
    stringRepeat(name, constant('2'));
    // @ts-expect-error -- a numeric operand is not a string
    stringReplaceAll(field(double(), 'rank'), constant('a'), constant('x'));
  });

  it('substring is dual-arity: an optional length operand', () => {
    expect(substring(name, constant(1))).toStrictEqual(
      new BinaryFunction('substring', string(), name, constant(1)),
    );
    expect(substring(name, constant(1), constant(2))).toStrictEqual(
      new TernaryFunction('substring', string(), name, constant(1), constant(2)),
    );
    // @ts-expect-error -- position is numeric
    substring(name, constant('1'));
  });

  it('like and the regex predicates propagate null; regexFind is ALWAYS nullable', () => {
    for (const fn of [like, regexContains, regexMatch] as const) {
      expect(fn(name, constant('a%')).type).toStrictEqual(bool());
      const viaNullable = fn(field(nullable(string()), 'ns'), constant('a'));
      expect(viaNullable.type).toStrictEqual(nullable(bool()));
    }
    // regexFind returns null on NO MATCH, so it is nullable even over
    // non-null operands (probed).
    const found = regexFind(name, constant('b+'));
    expect(found.type).toStrictEqual(nullable(string()));
    expectTypeOf(found.type).toEqualTypeOf(nullable(string()));
    // regexFindAll returns an empty array instead — plain unless operands are nullable.
    const all = regexFindAll(name, constant('b+'));
    expect(all.type).toStrictEqual(array(string()));
    expectTypeOf(all.type).toEqualTypeOf(array(string()));
  });
});

describe('reference / type / vector operators', () => {
  const authors = rootCollection({ name: 'authors', schema: { name: string() } });

  it('documentId/collectionId take reference operands only', () => {
    const key = field(docRef(), '__name__');
    const refField = field(docRef(authors), 'ref');
    expect(documentId(key)).toStrictEqual(new UnaryFunction('documentId', string(), key));
    expect(collectionId(key).name).toBe('collectionId');
    documentId(refField);
    collectionId(refField);
    // @ts-expect-error -- a string is not a reference (probed: the backend rejects it too)
    documentId(field(string(), 'name'));
    // A nullable/optional reference propagates.
    const viaOptional = documentId(field(optional(docRef(authors)), 'oref'));
    expect(viaOptional.type).toStrictEqual(nullable(string()));
    expectTypeOf(viaOptional.type).toEqualTypeOf(nullable(string()));
  });

  it('type() observes null and returns the backend type-name vocabulary', () => {
    const t = type(field(nullable(string()), 'ns'));
    // Type-observing: a null VALUE yields the name 'null' — only ABSENCE
    // propagates, so a nullable (but present) operand keeps the plain
    // literal descriptor...
    expect(t.type.type).toBe('const');
    expectTypeOf(t.type).not.toEqualTypeOf(nullable(t.type));
    // ...while an optional operand becomes nullable.
    const viaOptional = type(field(optional(string()), 'os'));
    expect(viaOptional.type.type).toBe('union');
  });

  it('isType lifts its literal type name into a constant operand', () => {
    const call = isType(field(string(), 'name'), 'string');
    expect(call).toStrictEqual(
      new BinaryFunction('isType', bool(), field(string(), 'name'), constant('string')),
    );
    isType(field(double(), 'rank'), 'float64');
    // @ts-expect-error -- an arbitrary string is not a backend type name
    isType(field(string(), 'name'), 'varchar');
  });

  it('vector functions take vector operands only', () => {
    const vec = field(vector(), 'vec');
    expect(dotProduct(vec, vectorValue([1, 2]))).toStrictEqual(
      new BinaryFunction('dotProduct', double(), vec, vectorValue([1, 2])),
    );
    expect(cosineDistance(vec, vec).name).toBe('cosineDistance');
    expect(euclideanDistance(vec, vec).name).toBe('euclideanDistance');
    expect(vectorLength(vec)).toStrictEqual(new UnaryFunction('vectorLength', int64(), vec));
    // @ts-expect-error -- a number array field is not a vector (the tag axis at work)
    dotProduct(vec, field(array(double()), 'nums'));
    // @ts-expect-error -- a string is not a vector
    vectorLength(field(string(), 'name'));
  });
});

describe('document-reference values', () => {
  const authors = rootCollection({ name: 'authors', schema: { name: string() } });

  it('docRefValue is a dedicated node carrying its collection and id', () => {
    const ref = docRefValue(authors, ['a1']);
    expect(ref).toStrictEqual(new DocRefValue(authors, ['a1']));
    expect(ref.type).toStrictEqual(docRef(authors));
    expectTypeOf(ref.type).toEqualTypeOf(docRef(authors));
  });

  it('compares against reference operands only (probed: strings never match)', () => {
    const ref = docRefValue(authors, ['a1']);
    equal(field(docRef(), '__name__'), ref);
    equal(field(docRef(authors), 'ref'), ref);
    // @ts-expect-error -- a reference never equals a string (always-false on the backend)
    equal(ref, constant('authors/a1'));
  });

  it('value nodes are domain-bound: a node only inhabits expressions its descriptor fits', () => {
    // The Expression<T> union binds GeoPointValue/VectorValue/DocRefValue
    // through their `type` property — without that, every value node would
    // satisfy every operand domain.
    // @ts-expect-error -- a geopoint is not a string operand
    toUpper(geoPointValue(1, 2));
    // @ts-expect-error -- a vector is not a numeric operand
    abs(vectorValue([1]));
    // @ts-expect-error -- a geopoint never equals a string
    equal(geoPointValue(1, 2), constant('x'));
    // ...and inference reads the node's own descriptor, so same-domain pairs work.
    equal(geoPointValue(1, 2), field(geoPoint(), 'geo'));
    dotProduct(vectorValue([1, 2]), field(vector(), 'vec'));
  });

  it('doubles as a composite constant leaf, like geopoint/vector nodes', () => {
    const c = constant({ author: docRefValue(authors, ['a1']) });
    const oracle = map({ author: docRef(authors) });
    expect(c.type).toStrictEqual(oracle);
    expectTypeOf(c.type).toEqualTypeOf(oracle);
  });
});
