import { describe, expect, expectTypeOf, it } from 'vitest';

import { expectTypedStrictEqual } from '../__test__/assertion.js';
import { refPath } from '../path.js';
import {
  type AnyUnionType,
  array,
  type ArrayType,
  bool,
  type BoolType,
  bytes,
  docRef,
  double,
  type FieldType,
  geoPoint,
  int64,
  literal,
  map,
  type MapType,
  nullable,
  nullType,
  optional,
  rootCollection,
  string,
  type StringType,
  timestamp,
  union,
  type UnionType,
  vector,
} from '../schema.js';
import {
  abs,
  add,
  and,
  arrayConcat,
  arrayContains,
  arrayContainsAll,
  arrayContainsAny,
  arrayGet,
  arrayLength,
  arrayReverse,
  arrayValue,
  byteLength,
  ceil,
  charLength,
  collectionId,
  conditional,
  constant,
  Constant,
  cosineDistance,
  currentTimestamp,
  divide,
  DocRefValue,
  docRefValue,
  documentId,
  dotProduct,
  endsWith,
  equal,
  equalAny,
  euclideanDistance,
  exists,
  exp,
  type Expression,
  Field,
  field,
  floor,
  FunctionCall,
  geoPointValue,
  greaterThan,
  greaterThanOrEqual,
  ifAbsent,
  ifError,
  ifNull,
  isAbsent,
  isError,
  isType,
  lessThan,
  lessThanOrEqual,
  like,
  ln,
  log10,
  logicalMaximum,
  logicalMinimum,
  ltrim,
  mapEntries,
  mapGet,
  mapKeys,
  mapMerge,
  mapRemove,
  mapSet,
  mapValue,
  mapValues,
  mod,
  multiply,
  not,
  notEqual,
  notEqualAny,
  or,
  pow,
  rand,
  regexContains,
  regexFind,
  regexFindAll,
  regexMatch,
  round,
  rtrim,
  sqrt,
  startsWith,
  stringConcat,
  stringContains,
  stringIndexOf,
  stringRepeat,
  stringReplaceAll,
  stringReplaceOne,
  stringReverse,
  substring,
  subtract,
  timestampAdd,
  timestampDiff,
  timestampExtract,
  timestampSubtract,
  timestampToUnixMicros,
  timestampToUnixMillis,
  timestampToUnixSeconds,
  timestampTruncate,
  toLower,
  toUpper,
  trim,
  trunc,
  type,
  type ExpressionWithAlias,
  unixMicrosToTimestamp,
  unixMillisToTimestamp,
  unixSecondsToTimestamp,
  vectorLength,
  vectorValue,
  xor,
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
    expectTypeOf(greaterThan(rank, count)).toEqualTypeOf<FunctionCall<BoolType>>();
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
    expectTypedStrictEqual(mixed.type, array(union(double(), string(), bool())));

    // Geopoint / vector nodes double as composite leaves (Firestore values
    // hold them at any depth; they have no plain-JS representation, so the
    // explicit nodes stand in).
    const withNodes = constant({ spot: geoPointValue(1, 3), embedding: [vectorValue([1, 2])] });
    expectTypedStrictEqual(withNodes.type, map({ spot: geoPoint(), embedding: array(vector()) }));

    const nestedMixed = constant({ deep: [1, 'a'] });
    expectTypedStrictEqual(nestedMixed.type, map({ deep: array(union(double(), string())) }));

    // Null in ELEMENT position: an element/field descriptor like any other.
    const nullElement = constant([1, null]);
    expectTypedStrictEqual(nullElement.type, array(union(double(), nullType())));
    const nullField = constant({ a: null });
    expectTypedStrictEqual(nullField.type, map({ a: nullType() }));

    // A reference node as an ARRAY element (the map-field leaf is covered above).
    const refElement = constant([docRefValue(['authors', 'a1'])]);
    expectTypedStrictEqual(refElement.type, array(docRef()));

    // Same-kind value nodes dedup to one element descriptor.
    const vectors = constant([vectorValue([1]), vectorValue([2])]);
    expectTypedStrictEqual(vectors.type, array(vector()));

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

  it('derives boolean result descriptors for comparisons and logical operators', () => {
    const cmp = lessThan(rank, count);
    expectTypedStrictEqual(cmp.type, bool());

    const neg = not(flag);
    expectTypedStrictEqual(neg.type, bool());
    expectTypeOf(neg).toEqualTypeOf<FunctionCall<BoolType>>();

    const both = and(flag, cmp, neg);
    expectTypedStrictEqual(both.type, bool());
    expectTypeOf(both).toEqualTypeOf<FunctionCall<BoolType>>();
  });
});

describe('aliasing (.as)', () => {
  it('binds every node kind to an alias as plain data', () => {
    const f = field(string(), 'name');
    expect(f.as('x')).toStrictEqual({ expression: f, alias: 'x' });

    const c = constant(1);
    expect(c.as('n')).toStrictEqual({ expression: c, alias: 'n' });

    // Value nodes are not expressions — they alias through constant().
    const g = constant(geoPointValue(1, 2));
    expect(g.as('g')).toStrictEqual({ expression: g, alias: 'g' });

    const v = constant(vectorValue([1]));
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
      expectTypedStrictEqual(constant(n).type, double());
    }
  });

  it('Buffer is bytes (it is a Uint8Array)', () => {
    expectTypedStrictEqual(constant(Buffer.from([1, 2])).type, bytes());
  });

  it('an empty map is valid (unlike an empty array)', () => {
    expectTypedStrictEqual(constant({}).type, map({}));
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
    expectTypedStrictEqual(c.type, array(map({ a: double(), b: double() })));
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

  // `equal` is prototyped with direct-literal operands, giving it a signature
  // that differs from its siblings, so the heterogeneous `table` union is no
  // longer directly callable. Forwarding each entry to a helper typed against a
  // single sibling signature keeps the shared-domain assertions in one place
  // (the operand-input generalization is a supertype of the old signature, so
  // every operator remains assignable to it).
  const checkSharedDomains = (
    fnName: (typeof table)[number][0],
    cmp: (left: Expression, right: Expression) => FunctionCall<BoolType>,
  ) => {
    // number domain (int64 / double / numeric literal / number constant)
    expect(cmp(rank, count).call.name).toBe(fnName);
    expect(cmp(field(literal(1, 2), 'lv'), constant(2)).call.name).toBe(fnName);
    // string domain (plain / literal)
    expect(cmp(field(literal('x', 'y'), 's'), constant('x')).call.name).toBe(fnName);
    // same-T pairs for the remaining groups
    expect(cmp(field(timestamp(), 'at'), constant(new Date(0))).call.name).toBe(fnName);
    expect(cmp(field(bytes(), 'raw'), constant(new Uint8Array([1]))).call.name).toBe(fnName);
    expect(cmp(field(geoPoint(), 'geo'), constant(geoPointValue(1, 2))).call.name).toBe(fnName);
    expect(cmp(field(vector(), 'vec'), constant(vectorValue([1]))).call.name).toBe(fnName);
    expect(cmp(field(nullType(), 'z'), constant(null)).call.name).toBe(fnName);
    // function operands nest (bool same-T)
    expect(cmp(equal(rank, count), constant(true)).call.name).toBe(fnName);
  };

  it('every comparison shares the same operand domains', () => {
    for (const [fnName, cmp] of table) {
      checkSharedDomains(fnName, cmp);
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
    // The compiler checks the five-operand, nested-operand payload; the
    // remaining runtime claim is the result descriptor.
    const five = and(flag, cmp, not(flag), or(flag, cmp), not(not(flag)));
    expectTypedStrictEqual(five.type, bool());
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
    expectTypedStrictEqual(strict.type, bool());

    // A nullable operand propagates.
    const viaNullable = and(flag, field(nullable(bool()), 'nb'));
    expectTypedStrictEqual(viaNullable.type, nullableBool);

    // An optional (possibly absent) operand counts too: an absent operand
    // flows through functions as null (probed).
    const viaOptional = or(flag, field(optional(bool()), 'ob'));
    expectTypedStrictEqual(viaOptional.type, nullableBool);

    // A boolean literal union containing null counts.
    const viaLiteral = or(flag, field(literal(true, null), 'ln'));
    expectTypedStrictEqual(viaLiteral.type, nullableBool);

    // not() propagates, and nested nullability flows upward.
    const viaNot = not(field(nullable(bool()), 'nb'));
    expectTypedStrictEqual(viaNot.type, nullableBool);
    const nested = and(flag, viaNot);
    expectTypedStrictEqual(nested.type, nullableBool);

    // Comparisons do NOT propagate: they are total (never null), even over
    // nullable operands.
    const cmp = equal(field(nullable(string()), 'ns'), constant(null));
    expectTypedStrictEqual(cmp.type, bool());
  });
});

describe('arithmetic operators', () => {
  const rank = field(double(), 'rank');
  const count = field(int64(), 'count');

  it('builds function-call nodes across all three arities', () => {
    // Nullary / unary / binary shapes are compile-checked by the payload types;
    // the runtime claim that remains is the result descriptor.
    expectTypedStrictEqual(rand().type, double());
    expectTypedStrictEqual(abs(rank).type, double());
    expectTypedStrictEqual(add(rank, count).type, double());
  });

  it('unary functions share the numeric domain; the rounding family preserves int64', () => {
    // Type-preserving (probed): int64 in, int64 out.
    const preserving = [
      ['abs', abs],
      ['ceil', ceil],
      ['floor', floor],
    ] as const;
    for (const [, fn] of preserving) {
      expectTypedStrictEqual(fn(count).type, int64());
      expectTypedStrictEqual(fn(rank).type, double());
    }
    // Always-double (probed): sqrt/exp/ln/log10 leave the integer domain.
    const alwaysDouble = [
      ['sqrt', sqrt],
      ['exp', exp],
      ['ln', ln],
      ['log10', log10],
    ] as const;
    for (const [fnName, fn] of alwaysDouble) {
      expectTypedStrictEqual(fn(count).type, double());
      // Literal-typed numeric fields are inside the domain (dispatch confirms acceptance).
      expect(fn(field(literal(1, 2), 'lv')).call.name).toBe(fnName);
    }
    // round/trunc carry an extra generic for the optional decimal-places
    // operand, so a union-typed table entry is not callable — exercised
    // individually. They preserve the FIRST operand's kind even with decimal
    // places (probed).
    expectTypedStrictEqual(round(count).type, int64());
    expectTypedStrictEqual(trunc(count, constant(1)).type, int64());
    expectTypedStrictEqual(round(rank).type, double());
    // @ts-expect-error -- a string operand is not numeric
    abs(field(string(), 'name'));
  });

  it('binary type-preserving functions keep an int64 pair; any double side widens', () => {
    expectTypedStrictEqual(add(count, count).type, int64());
    expectTypedStrictEqual(divide(count, count).type, int64());
    expectTypedStrictEqual(add(count, rank).type, double());
    // A number constant is a DoubleType — it widens.
    expectTypedStrictEqual(add(count, constant(2)).type, double());
    // pow is always a double, even over an int64 pair (probed).
    expectTypedStrictEqual(pow(count, count).type, double());
    // Null propagation wraps around the refined kind.
    const viaNullable = add(count, field(nullable(int64()), 'n'));
    expectTypedStrictEqual(viaNullable.type, nullable(int64()));
  });

  it('every binary function shares the numeric domain and DoubleType result', () => {
    // `add` is prototyped with direct-literal operands (a superset signature),
    // so it is exercised on its own rather than in the shared union table.
    expectTypedStrictEqual(add(rank, constant(2)).type, double());
    const table = [
      ['subtract', subtract],
      ['multiply', multiply],
      ['divide', divide],
      ['mod', mod],
    ] as const;
    for (const [fnName, fn] of table) {
      // Dispatch (name) confirms the numeric domain is accepted; the result is DoubleType.
      expect(fn(rank, constant(2)).call.name).toBe(fnName);
      expectTypedStrictEqual(fn(rank, constant(2)).type, double());
    }
    expectTypedStrictEqual(pow(rank, constant(2)).type, double());
    // @ts-expect-error -- a string operand is not numeric
    add(field(string(), 'name'), constant(1));
    // @ts-expect-error -- a boolean operand is not numeric
    multiply(rank, field(bool(), 'flag'));
  });

  it('round/trunc are dual-arity: an optional decimal-places operand', () => {
    // The two-operand shape is compile-checked; the descriptor is the runtime claim.
    expectTypedStrictEqual(round(rank, constant(2)).type, double());
    expectTypedStrictEqual(trunc(rank, count).type, double());
    // @ts-expect-error -- decimal places must be numeric
    round(rank, constant('2'));
  });

  it('propagates operand nullability, and rand (no operands) never does', () => {
    const nullableDouble = nullable(double());
    const viaNullable = add(rank, field(nullable(int64()), 'nc'));
    expectTypedStrictEqual(viaNullable.type, nullableDouble);
    const viaOptional = sqrt(field(optional(double()), 'od'));
    expectTypedStrictEqual(viaOptional.type, nullableDouble);
    const viaDecimals = round(rank, field(nullable(int64()), 'nd'));
    expectTypedStrictEqual(viaDecimals.type, nullableDouble);
    expectTypedStrictEqual(rand().type, double());
  });

  it('PropagateNull matrix: a literal-null source and a left-side nullable operand', () => {
    // A literal whose value set includes null propagates outside the boolean
    // domain too — the null value widens the numeric result to nullable.
    const litNull = add(field(literal(1, null), 'ln'), field(int64(), 'i'));
    expectTypedStrictEqual(litNull.type, nullable(double()));
    // The LEFT operand's nullability propagates exactly as the right's does
    // (the existing arithmetic cases put the nullable operand on the right).
    const leftNullable = add(field(nullable(int64()), 'n'), field(int64(), 'i'));
    expectTypedStrictEqual(leftNullable.type, nullable(int64()));
  });

  it('NumericResult composes with the null wrap over nullable / optional operands', () => {
    // A double side keeps the result double; the nullable operand wraps it.
    const nd = add(field(nullable(double()), 'nd'), field(double(), 'd2'));
    expectTypedStrictEqual(nd.type, nullable(double()));
    // An optional int64 pair strips to int64 for the kind, then absence wraps it.
    const oi = add(field(optional(int64()), 'oi'), field(int64(), 'i2'));
    expectTypedStrictEqual(oi.type, nullable(int64()));
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
      // Dispatch confirms the operator; the descriptor is per-row (string/int64).
      // The heterogeneous table makes the loop body types unions, so the
      // per-row exactness of `expectTypedStrictEqual` cannot be carried here.
      expect(fn(name).call.name).toBe(fnName);
      expect(fn(name).type).toStrictEqual(resultType);
      // Literal-typed string fields are inside the domain.
      expect(fn(gender).call.name).toBe(fnName);
    }
    // The trim family carries an extra generic for the optional character-set
    // operand, so a union-typed table entry is not callable — exercised
    // individually.
    expectTypedStrictEqual(trim(name).type, string());
    expectTypedStrictEqual(ltrim(name).type, string());
    expectTypedStrictEqual(rtrim(name).type, string());
    expect(trim(gender).call.name).toBe('trim');
    // @ts-expect-error -- a numeric operand is not a string
    toUpper(field(double(), 'rank'));
  });

  it('trim family is dual-arity: an optional character-set operand', () => {
    // The two-operand shape is compile-checked; the descriptor is the runtime claim.
    expectTypedStrictEqual(trim(name, constant('"')).type, string());
    expect(ltrim(name, constant('x')).call.name).toBe('ltrim');
    expect(rtrim(name, constant('x')).call.name).toBe('rtrim');
    // @ts-expect-error -- the character set must be a string
    trim(name, constant(1));
  });

  it('predicates return BoolType but PROPAGATE null (unlike comparisons)', () => {
    expectTypedStrictEqual(startsWith(name, constant('a')).type, bool());
    expectTypedStrictEqual(endsWith(name, constant('a')).type, bool());
    expectTypedStrictEqual(stringContains(name, constant('a')).type, bool());
    // `startsWith` is prototyped with direct-literal operands, so it is
    // exercised individually rather than in the shared union.
    const startsWithNullable = startsWith(field(nullable(string()), 'ns'), constant('a'));
    expectTypedStrictEqual(startsWithNullable.type, nullable(bool()));
    for (const fn of [endsWith, stringContains] as const) {
      const viaNullable = fn(field(nullable(string()), 'ns'), constant('a'));
      expectTypedStrictEqual(viaNullable.type, nullable(bool()));
    }
    // A propagated predicate is still a valid condition (BooleanValued domain).
    and(field(bool(), 'flag'), startsWith(field(nullable(string()), 'ns'), constant('a')));
    // @ts-expect-error -- a numeric operand is not a string
    startsWith(field(double(), 'rank'), constant('a'));
  });

  it('stringConcat takes two or more strings and propagates nullability', () => {
    const c = stringConcat(name, constant('-'), gender);
    expectTypedStrictEqual(c.type, string());
    const viaNullable = stringConcat(name, field(nullable(string()), 'ns'));
    expectTypedStrictEqual(viaNullable.type, nullable(string()));
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

  it('PropagateNull matrix: a literal-null string source and a left-side nullable predicate operand', () => {
    // A literal whose value set includes null propagates through a transform.
    const sn = toUpper(field(literal('a', null), 'sn'));
    expectTypedStrictEqual(sn.type, nullable(string()));
    // A predicate with the nullable operand on the LEFT propagates (the string
    // predicates PROPAGATE null, unlike the total comparison operators).
    const leftNullable = endsWith(field(nullable(string()), 'nsl'), constant('a'));
    expectTypedStrictEqual(leftNullable.type, nullable(bool()));
  });
});

describe('string operators (slice 3)', () => {
  const name = field(string(), 'name');

  it('indexOf / repeat / replace / substring shapes and domains', () => {
    expectTypedStrictEqual(stringIndexOf(name, constant('b')).type, int64());
    expectTypedStrictEqual(stringRepeat(name, constant(2)).type, string());
    expectTypedStrictEqual(stringReplaceAll(name, constant('a'), constant('x')).type, string());
    expectTypedStrictEqual(stringReplaceOne(name, constant('a'), constant('x')).type, string());
    // @ts-expect-error -- the repeat count is numeric
    stringRepeat(name, constant('2'));
    // @ts-expect-error -- a numeric operand is not a string
    stringReplaceAll(field(double(), 'rank'), constant('a'), constant('x'));
  });

  it('substring is dual-arity: an optional length operand', () => {
    // Both arities are compile-checked; the descriptor is the runtime claim.
    expectTypedStrictEqual(substring(name, constant(1)).type, string());
    expectTypedStrictEqual(substring(name, constant(1), constant(2)).type, string());
    // @ts-expect-error -- position is numeric
    substring(name, constant('1'));
  });

  it('like and the regex predicates propagate null; regexFind is ALWAYS nullable', () => {
    // A heterogeneous union of factories: the loop body types are unions, so
    // the per-row exactness of `expectTypedStrictEqual` cannot be carried.
    for (const fn of [like, regexContains, regexMatch] as const) {
      expect(fn(name, constant('a%')).type).toStrictEqual(bool());
      const viaNullable = fn(field(nullable(string()), 'ns'), constant('a'));
      expect(viaNullable.type).toStrictEqual(nullable(bool()));
    }
    // regexFind returns null on NO MATCH, so it is nullable even over
    // non-null operands (probed).
    const found = regexFind(name, constant('b+'));
    expectTypedStrictEqual(found.type, nullable(string()));
    // regexFindAll returns an empty array instead — plain unless operands are nullable.
    const all = regexFindAll(name, constant('b+'));
    expectTypedStrictEqual(all.type, array(string()));
  });
});

describe('reference / type / vector operators', () => {
  const authors = rootCollection({ name: 'authors', schema: { name: string() } });

  it('documentId/collectionId take reference operands only', () => {
    const key = field(docRef(), '__name__');
    const refField = field(docRef(authors), 'ref');
    expectTypedStrictEqual(documentId(key).type, string());
    expect(collectionId(key).call.name).toBe('collectionId');
    documentId(refField);
    collectionId(refField);
    // @ts-expect-error -- a string is not a reference (probed: the backend rejects it too)
    documentId(field(string(), 'name'));
    // A nullable/optional reference propagates.
    const viaOptional = documentId(field(optional(docRef(authors)), 'oref'));
    expectTypedStrictEqual(viaOptional.type, nullable(string()));
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

  it('isType returns bool and constrains the type name to the backend vocabulary', () => {
    // The literal type name is a plain payload field (not a lifted constant) —
    // a fact the payload type enforces at compile time; the runtime claim is
    // the result descriptor and the name-vocabulary rejection below.
    expectTypedStrictEqual(isType(field(string(), 'name'), 'string').type, bool());
    isType(field(double(), 'rank'), 'float64');
    // @ts-expect-error -- an arbitrary string is not a backend type name
    isType(field(string(), 'name'), 'varchar');
  });

  it('vector functions take vector operands only', () => {
    const vec = field(vector(), 'vec');
    expectTypedStrictEqual(dotProduct(vec, constant(vectorValue([1, 2]))).type, double());
    expect(cosineDistance(vec, vec).call.name).toBe('cosineDistance');
    expect(euclideanDistance(vec, vec).call.name).toBe('euclideanDistance');
    expectTypedStrictEqual(vectorLength(vec).type, int64());
    // @ts-expect-error -- a number array field is not a vector (the tag axis at work)
    dotProduct(vec, field(array(double()), 'nums'));
    // @ts-expect-error -- a string is not a vector
    vectorLength(field(string(), 'name'));
  });

  it('PropagateAbsence matrix: isType observes null but propagates only absence', () => {
    // An OPTIONAL (possibly-absent) operand widens the bool result to nullable:
    // an absent operand flows through as null.
    expectTypedStrictEqual(
      isType(field(optional(string()), 'os2'), 'string').type,
      nullable(bool()),
    );
    // A nullable (present-null) operand does NOT propagate — a null VALUE is
    // observed as the 'null' type, not a null result.
    expectTypedStrictEqual(isType(field(nullable(string()), 'ns3'), 'string').type, bool());
    // A plain operand does not propagate either.
    expectTypedStrictEqual(isType(field(string(), 'ps'), 'string').type, bool());
  });

  it('PropagateAbsence matrix: type() does not propagate over a literal-null or plain operand', () => {
    // type()'s return is LiteralType<FirestoreTypeName[]> (an array element
    // type), while the oracle literal(...) is a tuple, so the two are
    // intentionally type-unequal: plain toStrictEqual (like mapValues(profile)).
    const typeNames = literal(
      'null',
      'boolean',
      'string',
      'bytes',
      'number',
      'int32',
      'int64',
      'float64',
      'decimal128',
      'timestamp',
      'geo_point',
      'reference',
      'array',
      'map',
      'vector',
      'max_key',
      'min_key',
      'object_id',
      'regex',
      'request_timestamp',
    );
    // A literal-null (null tag, NOT optional) operand does not propagate: the
    // null value is observed as the 'null' type, so the descriptor stays the
    // plain type-name literal.
    const litNull = type(field(literal('a', null), 'ln4'));
    expect(litNull.type).toStrictEqual(typeNames);
    expectTypeOf(litNull.type).not.toEqualTypeOf(nullable(litNull.type));
    // A plain operand likewise does not propagate.
    expect(type(field(string(), 'ps4')).type).toStrictEqual(typeNames);
  });
});

describe('existence / error / conditional operators (slice 5)', () => {
  const name = field(string(), 'name');
  const rank = field(int64(), 'rank');
  const optName = field(optional(string()), 'optName');
  const nullableName = field(nullable(string()), 'nullableName');

  it('exists/isAbsent take FIELD references only and are total booleans', () => {
    expectTypedStrictEqual(exists(name).type, bool());
    expectTypedStrictEqual(isAbsent(optName).type, bool());
    // @ts-expect-error -- the backend requires a field reference, not a constant
    exists(constant(1));
    // @ts-expect-error -- nor any computed expression
    isAbsent(toUpper(name));
    // Total: no nullable widening even over optional fields.
    expectTypedStrictEqual(exists(optName).type, bool());
  });

  it('isError is total over any expression', () => {
    expectTypedStrictEqual(isError(divide(rank, constant(0))).type, bool());
    expectTypedStrictEqual(isError(field(optional(string()), 'o')).type, bool());
  });

  it('ifError unions try/catch and lets absence through the try side', () => {
    const same = ifError(name, constant('x'));
    expectTypedStrictEqual(same.type, string());
    const mixed = ifError(name, constant(0));
    expectTypedStrictEqual(mixed.type, union(string(), double()));
    // An optional try side may come out absent -> nullable approximation.
    const viaOptional = ifError(optName, constant('x'));
    expectTypedStrictEqual(viaOptional.type, nullable(string()));
  });

  it('ifAbsent unions value/fallback; a present null passes through', () => {
    const t = ifAbsent(optName, constant('dflt'));
    expectTypedStrictEqual(t.type, string());
    const nullableThrough = ifAbsent(nullableName, constant('dflt'));
    // null is a VALUE for ifAbsent — it survives in the pass-through side.
    expectTypedStrictEqual(nullableThrough.type, union(nullable(string()), string()));
  });

  it('ifNull strips null from the pass-through side', () => {
    const t = ifNull(nullableName, constant('dflt'));
    expectTypedStrictEqual(t.type, string());
    const widening = ifNull(nullableName, constant(0));
    expectTypedStrictEqual(widening.type, union(string(), double()));
    // A pure-null value always falls back.
    const pureNull = ifNull(field(nullType(), 'n'), constant('dflt'));
    expectTypedStrictEqual(pureNull.type, string());
  });

  it('conditional selects then/else; null, absent, and false all mean else', () => {
    const flag = field(bool(), 'flag');
    const t = conditional(flag, constant('a'), constant(0));
    expectTypedStrictEqual(t.type, union(string(), double()));
    const same = conditional(flag, name, field(string(), 'other'));
    expectTypedStrictEqual(same.type, string());
    // @ts-expect-error -- the condition is a boolean operand
    conditional(name, constant('a'), constant('b'));
  });

  it('logicalMaximum/Minimum ignore null and dedup operand types', () => {
    const t = logicalMaximum(rank, field(double(), 'score'));
    expectTypedStrictEqual(t.type, union(int64(), double()));
    const same = logicalMinimum(rank, rank);
    expectTypedStrictEqual(same.type, int64());
    // Null-typed operands are ignored in the result type...
    const withNull = logicalMaximum(rank, field(nullable(int64()), 'n'));
    expectTypedStrictEqual(withNull.type, int64());
    // ...unless EVERY operand may be null/absent — then null can surface.
    const allNullable = logicalMaximum(
      field(nullable(int64()), 'a'),
      field(optional(int64()), 'b'),
    );
    expectTypedStrictEqual(allNullable.type, union(int64(), nullType()));
  });

  it('equalAny/notEqualAny take one array-typed options expression', () => {
    expectTypedStrictEqual(equalAny(rank, constant([1, 5, 9])).type, bool());
    equalAny(rank, field(array(int64()), 'options'));
    notEqualAny(name, constant(['a', 'b']));
    // @ts-expect-error -- options must be an array, not a scalar
    equalAny(rank, constant(1));
    // @ts-expect-error -- elements must be comparable with the value
    equalAny(rank, constant(['a', 'b']));
  });

  it('EitherType strips Optional markers from both branches', () => {
    // Unequal sides, the value side Optional: its marker is dropped and the
    // result is the union of the two bare descriptors.
    const u = ifAbsent(field(optional(string()), 'o2'), constant(0));
    expectTypedStrictEqual(u.type, union(string(), double()));
    // Both branches carry a marker to strip: ifNull null-strips the value side,
    // and the fallback side drops its Optional marker — leaving equal
    // StringTypes, which collapse to a single descriptor.
    const both = ifNull(field(nullable(string()), 'ns2'), field(optional(string()), 'of'));
    expectTypedStrictEqual(both.type, string());
  });

  it('StripNull matrix: literal arms and the never / wide edges', () => {
    // Literal pass-through arm: ifNull strips null from the literal's VALUE set,
    // keeping literal('a'); unequal to the string fallback, so their union. This
    // matches the naive expectation — the literal survives, only its null value
    // is dropped.
    const lit = ifNull(field(literal('a', null), 'l2'), constant('d'));
    expectTypedStrictEqual(lit.type, union(literal('a'), string()));
    // An all-null literal strips to `never`, so ifNull collapses to the fallback.
    const allNull = ifNull(field(literal(null), 'ln2'), constant('d'));
    expectTypedStrictEqual(allNull.type, string());
    // Wide value arm (best-effort, type-level only): StripNull passes a wide
    // FieldType operand through unchanged, so it surfaces as a union member
    // beside the fallback. The runtime narrows to the concrete operand, so this
    // is a type-level-only claim.
    const wide: Expression = field(string(), 'w2');
    expectTypeOf(ifNull(wide, constant('d')).type).toEqualTypeOf<
      UnionType<[FieldType, StringType]>
    >();
  });

  it('LogicalExtreme matrix: all-null operands and mixed strip+dedup at arity 3', () => {
    // Every operand is pure null -> all are ignored -> the result is null.
    const allNull = logicalMaximum(field(nullType(), 'nn1'), field(nullType(), 'nn2'));
    expectTypedStrictEqual(allNull.type, nullType());
    // Arity 3, mixed: the nullable operand strips to int64, which dedups against
    // the plain int64; double stays -> union(int64, double) in first-occurrence
    // order (not every operand may be null, so no NullType is appended).
    const mixed = logicalMaximum(
      field(nullable(int64()), 'la'),
      field(int64(), 'lb'),
      field(double(), 'lc'),
    );
    expectTypedStrictEqual(mixed.type, union(int64(), double()));
  });

  it('xor is a variadic Kleene boolean', () => {
    const flag = field(bool(), 'flag');
    expectTypedStrictEqual(xor(flag, flag).type, bool());
    const viaNullable = xor(flag, field(nullable(bool()), 'nb'));
    expectTypedStrictEqual(viaNullable.type, nullable(bool()));
    // @ts-expect-error -- operands are boolean
    xor(flag, name);
  });
});

describe('array / map operators (slice 6)', () => {
  const tags = field(array(string()), 'tags');
  const rank = field(int64(), 'rank');
  const profile = field(map({ age: int64(), name: string() }), 'profile');

  it('constructors take expression elements and derive element/field types', () => {
    const arr = arrayValue([rank, field(int64(), 'other')]);
    expectTypedStrictEqual(arr.type, array(int64()));
    const mixed = arrayValue([rank, field(string(), 'name')]);
    expectTypedStrictEqual(mixed.type, array(union(int64(), string())));
    // A number constant is a DoubleType — the honest numeric constant.
    expectTypedStrictEqual(arrayValue([rank, constant(1)]).type, array(union(int64(), double())));

    const m = mapValue({ a: rank, b: constant('x') });
    expectTypedStrictEqual(m.type, map({ a: int64(), b: string() }));
    // @ts-expect-error -- dotted keys are banned, as in the schema factories
    void (() => mapValue({ 'a.b': rank }));
    expect(() => mapValue({ ['a.b' as string]: rank })).toThrow(/must not contain/);
  });

  it('array accessors', () => {
    expectTypedStrictEqual(arrayLength(tags).type, int64());
    expectTypedStrictEqual(arrayReverse(tags).type, array(string()));
    // A nullable array operand: reverse strips null from the payload and
    // propagates it around it.
    const nullableTags = field(nullable(array(string())), 'nt');
    expectTypedStrictEqual(arrayReverse(nullableTags).type, nullable(array(string())));
    // arrayGet is always nullable (out-of-range is absent — probed).
    const got = arrayGet(tags, constant(0));
    expectTypedStrictEqual(got.type, nullable(string()));
    // @ts-expect-error -- not an array
    arrayLength(rank);
  });

  it('contains family: element comparability and array-side null propagation', () => {
    expectTypedStrictEqual(arrayContains(tags, constant('x')).type, bool());
    const nullableTags = field(nullable(array(string())), 'nt');
    expectTypedStrictEqual(arrayContains(nullableTags, constant('x')).type, nullable(bool()));
    expectTypedStrictEqual(arrayContainsAll(tags, constant(['a', 'b'])).type, bool());
    expectTypedStrictEqual(arrayContainsAny(tags, field(array(string()), 'other')).type, bool());
    // @ts-expect-error -- a number element cannot be contained in a string array
    arrayContains(tags, constant(1));
    // @ts-expect-error -- options elements must be comparable with the array's
    arrayContainsAll(tags, constant([1, 2]));
  });

  it('arrayConcat unions element types and propagates null', () => {
    const c = arrayConcat(tags, field(array(int64()), 'nums'));
    expectTypedStrictEqual(c.type, array(union(string(), int64())));
  });

  it('mapGet is key-aware', () => {
    // The key-aware lookup: key 'age' resolves to the int64 subschema.
    expectTypedStrictEqual(mapGet(profile, 'age').type, int64());
    // @ts-expect-error -- unknown keys are rejected on a precise map
    void (() => mapGet(profile, 'zz'));
    // An Optional field may be absent -> nullable (probed: missing key is absent).
    const withOptional = field(map({ o: optional(string()) }), 'm2');
    expectTypedStrictEqual(mapGet(withOptional, 'o').type, nullable(string()));
    // A nullable map propagates around the value type.
    const nm = field(nullable(map({ a: string() })), 'nm');
    expectTypedStrictEqual(mapGet(nm, 'a').type, nullable(string()));
  });

  it('map surgery updates the subschema', () => {
    // SetField / MergeFields are intersection records — structurally the same
    // fields as the flat map literal, but not identical for an exact-match type
    // guard, so these stay plain `toStrictEqual` (runtime-only claim).
    const set = mapSet(profile, 'flag', constant(true));
    expect(set.type).toStrictEqual(map({ age: int64(), name: string(), flag: bool() }));
    const overwrite = mapSet(profile, 'age', constant('now-a-string'));
    expect(overwrite.type).toStrictEqual(map({ age: string(), name: string() }));
    // mapRemove uses `Omit`, which flattens to the plain map literal — exact.
    const removed = mapRemove(profile, 'age');
    expectTypedStrictEqual(removed.type, map({ name: string() }));
    const merged = mapMerge(profile, mapValue({ age: constant('s'), z: constant(1) }));
    expect(merged.type).toStrictEqual(map({ name: string(), age: string(), z: double() }));
    // @ts-expect-error -- dotted keys are banned
    void (() => mapSet(profile, 'a.b', constant(1)));
  });

  it('map collections', () => {
    expectTypedStrictEqual(mapKeys(profile).type, array(string()));
    // Mixed field types degrade to the runtime union (type-level: the wide
    // union descriptor — record key order is not observable at the type level),
    // so this pairing is an intentional type/runtime mismatch: plain `toStrictEqual`.
    expect(mapValues(profile).type).toStrictEqual(array(union(int64(), string())));
    const uniform = field(map({ a: string(), b: string() }), 'u');
    expectTypedStrictEqual(mapValues(uniform).type, array(string()));
    expectTypedStrictEqual(mapEntries(uniform).type, array(map({ k: string(), v: string() })));
  });

  it('StripNull through arrayReverse: an optional-only array operand', () => {
    // The Optional marker is stripped (there is nothing null to strip), and
    // absence propagates around the reversed array.
    const oa = arrayReverse(field(optional(array(string())), 'oa'));
    expectTypedStrictEqual(oa.type, nullable(array(string())));
  });

  it('MapFieldUnion matrix: empty map, optional field, multi-type entries', () => {
    // Empty field set: the runtime yields a nullType element, while the type
    // level degrades to the wide AnyUnionType (record emptiness is not
    // observable at the type level) — an intentional type/runtime-unequal spot,
    // like mapValues(profile).
    const empty = mapValues(field(map({}), 'em'));
    expect(empty.type).toStrictEqual(array(nullType()));
    expectTypeOf(empty.type).toEqualTypeOf<ArrayType<AnyUnionType>>();
    // A single Optional field: its marker is dropped, leaving the bare element.
    expectTypedStrictEqual(
      mapValues(field(map({ a: optional(string()) }), 'om')).type,
      array(string()),
    );
    // mapEntries wraps each entry as { k, v }; a multi-type map degrades v to
    // the wide AnyUnionType at the type level while the runtime builds the
    // concrete union — the same intentional type/runtime-unequal spot.
    const entries = mapEntries(field(map({ a: int64(), b: string() }), 'me'));
    expect(entries.type).toStrictEqual(array(map({ k: string(), v: union(int64(), string()) })));
    expectTypeOf(entries.type).toEqualTypeOf<
      ArrayType<MapType<{ k: StringType; v: AnyUnionType }>>
    >();
  });

  it('SetField matrix: an optional entry and a nullable map operand', () => {
    // SetField is an intersection record — structurally the flat map but not
    // identical for the exact-match guard, so plain toStrictEqual (as the
    // existing map-surgery tests). The optional entry drops its marker.
    const set = mapSet(field(map({ a: string() }), 'm2'), 'b', field(optional(int64()), 'oi2'));
    expect(set.type).toStrictEqual(map({ a: string(), b: int64() }));
    // A nullable map operand: SetField runs on the null-stripped map, and null
    // propagates around the wrap.
    const nm = mapSet(field(nullable(map({ a: string() })), 'nm2'), 'b', field(int64(), 'bnum'));
    expect(nm.type).toStrictEqual(nullable(map({ a: string(), b: int64() })));
  });

  it('ElementsOf matrix: nullable array, union element, wide element', () => {
    // A nullable array: StripNull yields the array, ElementsOf its element,
    // wrapped as always-nullable (out-of-range is absent).
    const na = arrayGet(field(nullable(array(string())), 'na'), constant(0));
    expectTypedStrictEqual(na.type, nullable(string()));
    // A union element: the always-nullable wrap composes WITHOUT flattening —
    // nullable(union(string, int64)) = union(union(string, int64), null).
    const au = arrayGet(field(array(union(string(), int64())), 'au'), constant(0));
    expectTypedStrictEqual(au.type, nullable(union(string(), int64())));
    // ElementsOf's wide fallback arm (cell 22) is NOT exercisable: `arrayGet`
    // constrains its operand to `ArrayOperandInput`, and a truly-wide array
    // descriptor carries `firestoreType: unknown` (the `Any*` members), which
    // the domain guard rejects — the wide element cannot be reached without a
    // banned type assertion. Skipped per the best-effort rule (see the report).
  });
});

describe('timestamp operators', () => {
  const ts = field(timestamp(), 'createdAt');
  const num = field(int64(), 'secs');

  it('currentTimestamp is a nullary timestamp', () => {
    expectTypedStrictEqual(currentTimestamp().type, timestamp());
  });

  it('unix conversions map between the timestamp and numeric domains', () => {
    expectTypedStrictEqual(timestampToUnixSeconds(ts).type, int64());
    expect(timestampToUnixMillis(ts).call.name).toBe('timestampToUnixMillis');
    expect(timestampToUnixMicros(ts).call.name).toBe('timestampToUnixMicros');
    expectTypedStrictEqual(unixSecondsToTimestamp(num).type, timestamp());
    expect(unixMillisToTimestamp(num).call.name).toBe('unixMillisToTimestamp');
    expect(unixMicrosToTimestamp(num).call.name).toBe('unixMicrosToTimestamp');
    // @ts-expect-error -- a number is not a timestamp
    timestampToUnixSeconds(num);
    // @ts-expect-error -- a timestamp is not a unix epoch number
    unixSecondsToTimestamp(ts);
    // A nullable/optional operand propagates.
    const viaOptional = timestampToUnixSeconds(field(optional(timestamp()), 'ot'));
    expectTypedStrictEqual(viaOptional.type, nullable(int64()));
  });

  it('add/subtract carry a literal unit (a compile-checked plain payload field)', () => {
    expectTypedStrictEqual(timestampAdd(ts, 'day', constant(1)).type, timestamp());
    expect(timestampSubtract(ts, 'hour', constant(2)).call.name).toBe('timestampSubtract');
    // @ts-expect-error -- an arbitrary string is not a time unit
    timestampAdd(ts, 'fortnight', constant(1));
    // @ts-expect-error -- calendar granularities are add units the backend rejects
    timestampAdd(ts, 'month', constant(1));
    // @ts-expect-error -- the amount is a numeric operand
    timestampAdd(ts, 'day', constant('1'));
    // The amount operand's nullability propagates.
    const viaOptional = timestampAdd(ts, 'day', field(optional(int64()), 'n'));
    expectTypedStrictEqual(viaOptional.type, nullable(timestamp()));
  });

  it('diff is end - start in whole units', () => {
    expectTypedStrictEqual(timestampDiff(ts, ts, 'hour').type, int64());
    // @ts-expect-error -- units only: calendar granularities are rejected (probed)
    timestampDiff(ts, ts, 'month');
    // @ts-expect-error -- a number is not a timestamp
    timestampDiff(ts, num, 'hour');
  });

  it('truncate/extract are dual-arity over the optional literal timezone', () => {
    // Both arities and the literal granularity/part/timezone payload fields are
    // compile-checked; the descriptor is the runtime claim.
    expectTypedStrictEqual(timestampTruncate(ts, 'week(monday)').type, timestamp());
    expectTypedStrictEqual(timestampTruncate(ts, 'day', 'Asia/Tokyo').type, timestamp());
    expectTypedStrictEqual(timestampExtract(ts, 'dayofweek').type, int64());
    expect(timestampExtract(ts, 'hour', 'Asia/Tokyo').call.name).toBe('timestampExtract');
    // @ts-expect-error -- not a granularity
    timestampTruncate(ts, 'fortnight');
    // @ts-expect-error -- 'week(noday)' is not a week start day
    timestampTruncate(ts, 'week(noday)');
    // @ts-expect-error -- 'dayofweek' is extract-only, not a truncation granularity
    timestampTruncate(ts, 'dayofweek');
    // A nullable operand propagates through both arities.
    const viaOptional = timestampTruncate(field(optional(timestamp()), 'ot'), 'day');
    expectTypedStrictEqual(viaOptional.type, nullable(timestamp()));
  });
});

describe('document-reference values', () => {
  const authors = rootCollection({ name: 'authors', schema: { name: string() } });

  it('docRefValue is a dedicated node carrying a RefPath segment path', () => {
    const ref = docRefValue(refPath(authors, ['a1']));
    // Cross-source: the segment array is produced by refPath, checked against
    // the independently-written path — not a construction restatement.
    expect(ref).toStrictEqual(DocRefValue.of(['authors', 'a1']));
    expectTypedStrictEqual(ref.type, docRef());
  });

  it('the collection+address form is typed with the known collection', () => {
    const typed = docRefValue(authors, ['a1']);
    // The address normalizes to the SAME segment payload as the value form —
    // only the descriptor claim gains the collection.
    expect(typed.path).toStrictEqual(docRefValue(refPath(authors, ['a1'])).path);
    expectTypedStrictEqual(typed.type, docRef(authors));
    // @ts-expect-error -- the id tuple must match the collection's depth
    void (() => docRefValue(authors, ['a1', 'extra']));
    // Comparisons: typed and context-free flavors share the 'reference' tag.
    equal(field(docRef(authors), 'ref'), docRefValue(authors, ['a1']));
    equal(field(docRef(), '__name__'), docRefValue(authors, ['a1']));
  });

  it('compares against reference operands only (probed: strings never match)', () => {
    const ref = constant(docRefValue(refPath(authors, ['a1'])));
    equal(field(docRef(), '__name__'), ref);
    equal(field(docRef(authors), 'ref'), ref);
    // @ts-expect-error -- a reference never equals a string (always-false on the backend)
    equal(ref, constant('authors/a1'));
  });

  it('value nodes are not expressions: they enter only via constant(), which scopes their domain', () => {
    // A value node is a VALUE — constant() is the one lifting point (like
    // the SDK's constant(new GeoPoint(...))), and the lifted Constant<T>
    // carries the precise descriptor into domains and inference.
    // @ts-expect-error -- a raw value node is not an expression operand
    toUpper(geoPointValue(1, 2));
    // @ts-expect-error -- a geopoint constant is not a string operand
    toUpper(constant(geoPointValue(1, 2)));
    // @ts-expect-error -- a vector constant is not a numeric operand
    abs(constant(vectorValue([1])));
    // @ts-expect-error -- a geopoint never equals a string
    equal(constant(geoPointValue(1, 2)), constant('x'));
    // Same-domain pairs work, with inference reading the lifted descriptor.
    equal(constant(geoPointValue(1, 2)), field(geoPoint(), 'geo'));
    dotProduct(constant(vectorValue([1, 2])), field(vector(), 'vec'));
  });

  it('doubles as a composite constant leaf, like geopoint/vector nodes', () => {
    const c = constant({ author: docRefValue(refPath(authors, ['a1'])) });
    expectTypedStrictEqual(c.type, map({ author: docRef() }));
  });
});

describe('direct literal operands', () => {
  const rank = field(double(), 'rank');
  const i = field(int64(), 'i');
  const name = field(string(), 'name');
  const flag = field(bool(), 'flag');
  const ts = field(timestamp(), 'createdAt');
  const geo = field(geoPoint(), 'g');

  it('lifts a raw operand exactly as the constant()-wrapped equivalent (one representative)', () => {
    // ONE end-to-end equivalence oracle: a raw operand lands node-for-node
    // identical to its constant()-wrapped form, including the lifted Constant
    // in the payload. The lifting MECHANISM itself (scalars, value nodes,
    // expression pass-through, tuple arity, record fields) is covered once in
    // the `toOperand` mechanism-layer describe — not restated per factory.
    expect(equal(rank, 1)).toStrictEqual(equal(rank, constant(1)));
  });

  it('a lifted raw infers the same descriptor as the explicit constant form', () => {
    // A lifted number lands as DoubleType and widens an int64 pair, like constant(1).
    const viaRaw = add(i, 1);
    expectTypedStrictEqual(viaRaw.type, double());
    // Identical descriptor to the explicit-constant form.
    expectTypeOf(viaRaw.type).toEqualTypeOf(add(i, constant(1)).type);
    // Nullability still propagates around the refined kind.
    const viaNullable = add(i, field(nullable(int64()), 'n'));
    expectTypedStrictEqual(viaNullable.type, nullable(int64()));
    // round/trunc: omitting decimalPlaces, `TypeOfOperand<never>` is `never`,
    // a no-op union member, so an int64 value keeps Int64Type (no widening);
    // a lifted double decimalPlaces still cannot change the value-derived kind.
    expectTypedStrictEqual(round(i).type, int64());
    expectTypedStrictEqual(trunc(i, 2).type, int64());
    // Constructors infer element/field descriptors through the lifted raws.
    expectTypedStrictEqual(arrayValue([1, rank]).type, array(double()));
    expectTypedStrictEqual(mapValue({ a: 1 }).type, map({ a: double() }));
  });

  it('inference does not collapse: literal fields, null, and explicit constants', () => {
    // A literal('a','b') field carries the 'string' tag; the raw 'a' lifts to
    // StringType (ConstantTypeOf collapses the literal to StringType) — still
    // comparable by tag overlap.
    equal(field(literal('a', 'b'), 'l'), 'a');
    // A raw null lifts to NullType — an is-null check against a nullable field.
    equal(field(nullable(string()), 'ns'), null);
    // Explicit constant(...) operands keep compiling unchanged.
    equal(rank, constant(1));
    startsWith(name, constant('a'));
    and(flag, constant(true), not(flag));
    // Expression operands (the pre-prototype call shape) still work.
    equal(rank, i);
    startsWith(name, field(string(), 'prefix'));
  });

  it('domain constraints reject non-conforming raws across every family', () => {
    // One rejection per family: the operand-input domains are enforced on raws
    // exactly as on expressions.
    // @ts-expect-error -- string vs number: incomparable
    equal(field(string(), 's'), 1);
    // @ts-expect-error -- string vs number
    greaterThan(name, 1);
    // @ts-expect-error -- a number is not a string operand
    startsWith(name, 1);
    // @ts-expect-error -- a number is not a string operand
    toUpper(1);
    // @ts-expect-error -- a string is not numeric
    add(i, 'x');
    // @ts-expect-error -- a string is not numeric
    subtract(i, 'x');
    // @ts-expect-error -- decimal places must be numeric
    round(rank, 'x');
    // @ts-expect-error -- a string is not boolean-valued
    and(flag, 'yes');
    // @ts-expect-error -- a string is not boolean-valued
    or(flag, 'yes');
    // @ts-expect-error -- the condition must be boolean-valued
    conditional(1, 'big', 'small');
    // @ts-expect-error -- options must be an array, not a scalar
    equalAny(rank, 5);
    // @ts-expect-error -- a scalar is not a map operand
    mapKeys(1);
    // @ts-expect-error -- a number is not a vector operand
    vectorLength(1);
    // @ts-expect-error -- the amount is a numeric operand
    timestampAdd(ts, 'day', 'x');
    // @ts-expect-error -- the amount is numeric, not a string
    timestampSubtract(ts, 'day', 'x');
    // @ts-expect-error -- a plain-object map is not comparable to a geopoint
    equal(geo, { latitude: 1, longitude: 2 });
    expect(() =>
      // @ts-expect-error -- undefined is not a liftable operand
      arrayValue([undefined]),
    ).toThrow();
  });
});

describe('operand lifting mechanism (toOperand / liftOperands / liftFields)', () => {
  // The lifting helpers are module-private, so each ConstantValue shape is
  // observed THROUGH one factory — the mechanism is uniform across every
  // factory, so one representative per shape is enough (the payload field it
  // lands in is inspected after narrowing the payload by `name`). The
  // per-factory end-to-end equivalence is the single representative oracle in
  // the `direct literal operands` describe.
  const authors = rootCollection({ name: 'authors', schema: { name: string() } });
  const tags = field(array(string()), 'tags');
  const num = field(int64(), 'n');

  it('lifts a scalar to a Constant (via equal)', () => {
    const node = equal(num, 5);
    if (node.call.name === 'equal') {
      expect(node.call.right).toStrictEqual(constant(5));
    }
  });

  it('lifts each value node (geopoint / vector / docRef) to a Constant (via equal)', () => {
    // GeoPointValue / VectorValue / DocRefValue are ConstantValue leaves, not
    // expressions, so they take the lifting branch — constant(geoPointValue(...)).
    const gnode = equal(field(geoPoint(), 'g'), geoPointValue(1, 2));
    if (gnode.call.name === 'equal') {
      expect(gnode.call.right).toStrictEqual(constant(geoPointValue(1, 2)));
    }
    const vnode = equal(field(vector(), 'v'), vectorValue([1, 2]));
    if (vnode.call.name === 'equal') {
      expect(vnode.call.right).toStrictEqual(constant(vectorValue([1, 2])));
    }
    const rv = docRefValue(refPath(authors, ['a1']));
    const rnode = equal(field(docRef(), '__name__'), rv);
    if (rnode.call.name === 'equal') {
      expect(rnode.call.right).toStrictEqual(constant(rv));
    }
  });

  it('passes an expression through by identity — the SAME node object (via arrayLength)', () => {
    const node = arrayLength(tags);
    if (node.call.name === 'arrayLength') {
      expect(node.call.value).toBe(tags);
    }
  });

  it('lifts a plain array to an array Constant (via arrayLength)', () => {
    const node = arrayLength([1, 2, 3]);
    if (node.call.name === 'arrayLength') {
      expect(node.call.value).toStrictEqual(constant([1, 2, 3]));
    }
  });

  it('lifts a plain object to a map Constant (via mapKeys)', () => {
    const node = mapKeys({ a: 1, b: 'x' });
    if (node.call.name === 'mapKeys') {
      expect(node.call.value).toStrictEqual(constant({ a: 1, b: 'x' }));
    }
  });

  it('liftOperands preserves tuple arity and order (via arrayConcat)', () => {
    // A variadic factory lifts each operand in place, mirroring the input
    // tuple's arity: a pass-through expression, then a lifted raw array.
    const node = arrayConcat(tags, [1, 2]);
    if (node.call.name === 'arrayConcat') {
      expect(node.call.operands).toHaveLength(2);
      expect(node.call.operands[0]).toBe(tags);
      expect(node.call.operands[1]).toStrictEqual(constant([1, 2]));
    }
  });

  it('liftFields preserves the record keys, lifting each value (via mapValue)', () => {
    const node = mapValue({ a: 1, b: num });
    if (node.call.name === 'mapValue') {
      expect(Object.keys(node.call.fields)).toStrictEqual(['a', 'b']);
      expect(node.call.fields['a']).toStrictEqual(constant(1));
      // An expression field passes through by identity.
      expect(node.call.fields['b']).toBe(num);
    }
  });
});
