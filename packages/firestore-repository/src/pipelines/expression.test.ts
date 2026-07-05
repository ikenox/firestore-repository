import { describe, expectTypeOf, it } from 'vitest';

import {
  type ArrayType,
  array as arrayType,
  bool,
  type BoolType,
  bytes,
  type BytesType,
  double,
  type DoubleType,
  int64,
  type Int64Type,
  type MapFields,
  map as mapType,
  type MapType,
  string,
  type StringType,
  timestamp,
  type TimestampType,
  vector,
  type VectorType,
} from '../schema.js';
import {
  abs,
  add,
  and,
  array,
  arrayConcat,
  arrayContains,
  arrayContainsAll,
  arrayContainsAny,
  arrayGet,
  arrayLength,
  byteLength,
  ceil,
  charLength,
  collectionId,
  concat,
  conditional,
  constant,
  type Constant,
  cosineDistance,
  currentTimestamp,
  divide,
  documentId,
  dotProduct,
  endsWith,
  equal,
  equalAny,
  euclideanDistance,
  exists,
  exp,
  field,
  type Field,
  floor,
  type FunctionCall,
  greaterThan,
  greaterThanOrEqual,
  ifAbsent,
  ifError,
  isAbsent,
  isError,
  isType,
  join,
  lessThan,
  lessThanOrEqual,
  like,
  ln,
  log,
  logicalMaximum,
  logicalMinimum,
  ltrim,
  map,
  mapEntries,
  mapGet,
  mapKeys,
  mapMerge,
  mapRemove,
  mapSet,
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
  reverse,
  round,
  rtrim,
  split,
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
  unixMicrosToTimestamp,
  unixMillisToTimestamp,
  unixSecondsToTimestamp,
  vectorLength,
  xor,
} from './expression.js';

// Shared fixtures (real runtime nodes so operator calls can be evaluated).
const stringField: Field<StringType> = field(string(), 'stringField');
const stringOrIntField = field<StringType | Int64Type, 'stringOrIntField'>(
  string(),
  'stringOrIntField',
);
const intField: Field<Int64Type> = field(int64(), 'intField');
const doubleField: Field<DoubleType> = field(double(), 'doubleField');
const boolField: Field<BoolType> = field(bool(), 'boolField');
const timestampField: Field<TimestampType> = field(timestamp(), 'timestampField');
const bytesField: Field<BytesType> = field(bytes(), 'bytesField');
const vectorField: Field<VectorType> = field(vector(), 'vectorField');
const stringArrayField: Field<ArrayType<StringType, [], []>> = field(
  arrayType(string()),
  'stringArrayField',
);
const arrayField: Field<ArrayType> = field(arrayType(string()), 'arrayField');
const mapField: Field<MapType> = field(mapType({}), 'mapField');

// =============================================================================
// Comparison
// =============================================================================

describe('comparison operators — type inference', () => {
  describe('same concrete type', () => {
    it('accepts both sides of the same type', () => {
      expectTypeOf(equal(stringField, stringField)).toEqualTypeOf<FunctionCall<BoolType>>();
      equal(intField, intField);
      equal(doubleField, doubleField);
      equal(boolField, boolField);
      equal(timestampField, timestampField);
      equal(bytesField, bytesField);

      greaterThan(intField, intField);
      lessThan(timestampField, timestampField);
      notEqual(boolField, boolField);
    });
  });

  describe('numeric compatibility (Int64Type <-> DoubleType)', () => {
    it('allows comparing Int64Type and DoubleType in either order', () => {
      equal(intField, doubleField);
      equal(doubleField, intField);
      notEqual(intField, doubleField);
      greaterThan(intField, doubleField);
      lessThan(doubleField, intField);
      lessThanOrEqual(intField, doubleField);
      greaterThanOrEqual(doubleField, intField);
    });
  });

  describe('union vs narrow (covariant widening)', () => {
    it('accepts a union field compared against a narrow field within that union', () => {
      equal(stringOrIntField, stringField);
      equal(stringField, stringOrIntField);
      equal(stringOrIntField, intField);
      greaterThan(stringOrIntField, intField);
    });
  });

  describe('disjoint groups (string vs numeric, bool vs numeric, ...)', () => {
    it('rejects cross-group comparisons', () => {
      // @ts-expect-error string vs int
      equal(stringField, intField);
      // @ts-expect-error int vs string
      equal(intField, stringField);
      // @ts-expect-error string vs double
      equal(stringField, doubleField);
      // @ts-expect-error bool vs int
      equal(boolField, intField);
      // @ts-expect-error timestamp vs string
      equal(timestampField, stringField);
      // @ts-expect-error bytes vs int
      equal(bytesField, intField);

      // @ts-expect-error
      greaterThan(stringField, intField);
      // @ts-expect-error
      lessThan(boolField, doubleField);
      // @ts-expect-error
      notEqual(timestampField, intField);
    });
  });

  describe('equalAny / notEqualAny', () => {
    it('returns BoolType and accepts variadic candidates of compatible types', () => {
      expectTypeOf(equalAny(stringField, stringField)).toEqualTypeOf<FunctionCall<BoolType>>();
      equalAny(intField, doubleField, intField);
      notEqualAny(stringField, stringField, stringField);
    });

    it('rejects candidates from a disjoint group', () => {
      // @ts-expect-error
      equalAny(stringField, intField);
      // @ts-expect-error
      notEqualAny(boolField, intField);
    });
  });
});

// =============================================================================
// Logical
// =============================================================================

describe('logical operators', () => {
  it('and / or / xor accept variadic BoolType expressions and return BoolType', () => {
    expectTypeOf(and(boolField, boolField)).toEqualTypeOf<FunctionCall<BoolType>>();
    or(boolField, boolField, boolField);
    xor(boolField, boolField);
  });

  it('not accepts a single BoolType expression', () => {
    expectTypeOf(not(boolField)).toEqualTypeOf<FunctionCall<BoolType>>();
  });

  it('rejects non-boolean inputs', () => {
    // @ts-expect-error
    and(stringField, boolField);
    // @ts-expect-error
    or(intField);
    // @ts-expect-error
    not(intField);
    // @ts-expect-error
    xor(boolField, stringField);
  });
});

// =============================================================================
// Arithmetic
// =============================================================================

describe('arithmetic operators', () => {
  it('binary numeric ops return DoubleType', () => {
    expectTypeOf(add(intField, doubleField)).toEqualTypeOf<FunctionCall<DoubleType>>();
    expectTypeOf(subtract(intField, intField)).toEqualTypeOf<FunctionCall<DoubleType>>();
    expectTypeOf(multiply(doubleField, intField)).toEqualTypeOf<FunctionCall<DoubleType>>();
    expectTypeOf(divide(intField, doubleField)).toEqualTypeOf<FunctionCall<DoubleType>>();
    expectTypeOf(mod(intField, intField)).toEqualTypeOf<FunctionCall<DoubleType>>();
    expectTypeOf(pow(intField, intField)).toEqualTypeOf<FunctionCall<DoubleType>>();
    expectTypeOf(log(intField, intField)).toEqualTypeOf<FunctionCall<DoubleType>>();
  });

  it('unary numeric ops return DoubleType', () => {
    expectTypeOf(abs(intField)).toEqualTypeOf<FunctionCall<DoubleType>>();
    expectTypeOf(sqrt(doubleField)).toEqualTypeOf<FunctionCall<DoubleType>>();
    expectTypeOf(exp(intField)).toEqualTypeOf<FunctionCall<DoubleType>>();
    expectTypeOf(ln(intField)).toEqualTypeOf<FunctionCall<DoubleType>>();
    expectTypeOf(floor(doubleField)).toEqualTypeOf<FunctionCall<DoubleType>>();
    expectTypeOf(ceil(intField)).toEqualTypeOf<FunctionCall<DoubleType>>();
    expectTypeOf(round(doubleField)).toEqualTypeOf<FunctionCall<DoubleType>>();
    expectTypeOf(trunc(doubleField)).toEqualTypeOf<FunctionCall<DoubleType>>();
  });

  it('rand takes no args and returns DoubleType', () => {
    expectTypeOf(rand()).toEqualTypeOf<FunctionCall<DoubleType>>();
  });

  it('logicalMaximum / logicalMinimum are variadic and return DoubleType', () => {
    expectTypeOf(logicalMaximum(intField, doubleField, intField)).toEqualTypeOf<
      FunctionCall<DoubleType>
    >();
    expectTypeOf(logicalMinimum(intField)).toEqualTypeOf<FunctionCall<DoubleType>>();
  });

  it('rejects non-numeric inputs', () => {
    // @ts-expect-error
    add(stringField, intField);
    // @ts-expect-error
    abs(stringField);
    // @ts-expect-error
    pow(intField, boolField);
  });
});

// =============================================================================
// String
// =============================================================================

describe('string operators', () => {
  it('case / trim ops return StringType', () => {
    expectTypeOf(toUpper(stringField)).toEqualTypeOf<FunctionCall<StringType>>();
    expectTypeOf(toLower(stringField)).toEqualTypeOf<FunctionCall<StringType>>();
    expectTypeOf(trim(stringField)).toEqualTypeOf<FunctionCall<StringType>>();
    expectTypeOf(ltrim(stringField)).toEqualTypeOf<FunctionCall<StringType>>();
    expectTypeOf(rtrim(stringField)).toEqualTypeOf<FunctionCall<StringType>>();
  });

  it('charLength / byteLength return Int64Type', () => {
    expectTypeOf(charLength(stringField)).toEqualTypeOf<FunctionCall<Int64Type>>();
    expectTypeOf(byteLength(stringField)).toEqualTypeOf<FunctionCall<Int64Type>>();
    byteLength(bytesField); // bytes also accepted
  });

  it('substring returns StringType, accepts optional length', () => {
    expectTypeOf(substring(stringField, intField)).toEqualTypeOf<FunctionCall<StringType>>();
    substring(stringField, intField, intField);
  });

  it('concat / stringConcat are variadic, return StringType', () => {
    expectTypeOf(concat(stringField, stringField)).toEqualTypeOf<FunctionCall<StringType>>();
    stringConcat(stringField, stringField, stringField);
  });

  it('prefix / suffix / contains predicates return BoolType', () => {
    expectTypeOf(startsWith(stringField, stringField)).toEqualTypeOf<FunctionCall<BoolType>>();
    expectTypeOf(endsWith(stringField, stringField)).toEqualTypeOf<FunctionCall<BoolType>>();
    expectTypeOf(like(stringField, stringField)).toEqualTypeOf<FunctionCall<BoolType>>();
    expectTypeOf(stringContains(stringField, stringField)).toEqualTypeOf<FunctionCall<BoolType>>();
  });

  it('stringIndexOf returns Int64Type and accepts bytes search', () => {
    expectTypeOf(stringIndexOf(stringField, stringField)).toEqualTypeOf<FunctionCall<Int64Type>>();
    stringIndexOf(stringField, bytesField);
  });

  it('stringRepeat / stringReverse return StringType', () => {
    expectTypeOf(stringRepeat(stringField, intField)).toEqualTypeOf<FunctionCall<StringType>>();
    expectTypeOf(stringReverse(stringField)).toEqualTypeOf<FunctionCall<StringType>>();
  });

  it('stringReplaceOne / stringReplaceAll return StringType', () => {
    expectTypeOf(stringReplaceOne(stringField, stringField, stringField)).toEqualTypeOf<
      FunctionCall<StringType>
    >();
    expectTypeOf(stringReplaceAll(stringField, stringField, stringField)).toEqualTypeOf<
      FunctionCall<StringType>
    >();
  });

  it('regex predicates / extractors carry the expected return types', () => {
    expectTypeOf(regexMatch(stringField, stringField)).toEqualTypeOf<FunctionCall<BoolType>>();
    expectTypeOf(regexContains(stringField, stringField)).toEqualTypeOf<FunctionCall<BoolType>>();
    expectTypeOf(regexFind(stringField, stringField)).toEqualTypeOf<FunctionCall<StringType>>();
    expectTypeOf(regexFindAll(stringField, stringField)).toEqualTypeOf<
      FunctionCall<ArrayType<StringType, [], []>>
    >();
  });

  it('split returns ArrayType<StringType>, join returns StringType', () => {
    expectTypeOf(split(stringField, stringField)).toEqualTypeOf<
      FunctionCall<ArrayType<StringType, [], []>>
    >();
    expectTypeOf(join(stringArrayField, stringField)).toEqualTypeOf<FunctionCall<StringType>>();
  });

  it('rejects non-string inputs', () => {
    // @ts-expect-error
    toUpper(intField);
    // @ts-expect-error
    concat(stringField, intField);
    // @ts-expect-error
    startsWith(intField, stringField);
  });
});

// =============================================================================
// Array
// =============================================================================

describe('array operators', () => {
  it('array constructor accepts variadic expressions, returns ArrayType', () => {
    expectTypeOf(array(stringField, intField)).toEqualTypeOf<FunctionCall<ArrayType>>();
  });

  it('arrayLength returns Int64Type', () => {
    expectTypeOf(arrayLength(arrayField)).toEqualTypeOf<FunctionCall<Int64Type>>();
  });

  it('arrayGet returns FieldType (loose) — TODO: refine with element typing', () => {
    arrayGet(arrayField, intField);
  });

  it('arrayConcat returns ArrayType', () => {
    expectTypeOf(arrayConcat(arrayField, arrayField)).toEqualTypeOf<FunctionCall<ArrayType>>();
  });

  it('arrayContains* return BoolType', () => {
    expectTypeOf(arrayContains(stringArrayField, stringField)).toEqualTypeOf<
      FunctionCall<BoolType>
    >();
    expectTypeOf(arrayContainsAll(stringArrayField, stringArrayField)).toEqualTypeOf<
      FunctionCall<BoolType>
    >();
    expectTypeOf(arrayContainsAny(stringArrayField, stringArrayField)).toEqualTypeOf<
      FunctionCall<BoolType>
    >();
  });

  it('arrayContains rejects element of the wrong type', () => {
    // @ts-expect-error
    arrayContains(stringArrayField, intField);
  });

  it('reverse preserves the input ArrayType', () => {
    expectTypeOf(reverse(stringArrayField)).toEqualTypeOf<
      FunctionCall<ArrayType<StringType, [], []>>
    >();
  });

  it('rejects non-array inputs', () => {
    // @ts-expect-error
    arrayLength(stringField);
    // @ts-expect-error
    arrayConcat(stringField, arrayField);
  });
});

// =============================================================================
// Map
// =============================================================================

describe('map operators', () => {
  it('map constructor accepts a Record<string, Expression>', () => {
    expectTypeOf(map({ a: stringField, b: intField })).toEqualTypeOf<
      FunctionCall<MapType<MapFields>>
    >();
  });

  it('mapGet returns FieldType (loose) — TODO: refine via key-aware typing', () => {
    mapGet(mapField, stringField);
  });

  it('mapKeys returns ArrayType<StringType>', () => {
    expectTypeOf(mapKeys(mapField)).toEqualTypeOf<FunctionCall<ArrayType<StringType, [], []>>>();
  });

  it('mapEntries / mapValues return ArrayType (loose)', () => {
    expectTypeOf(mapEntries(mapField)).toEqualTypeOf<FunctionCall<ArrayType>>();
    expectTypeOf(mapValues(mapField)).toEqualTypeOf<FunctionCall<ArrayType>>();
  });

  it('mapMerge / mapRemove / mapSet return MapType', () => {
    expectTypeOf(mapMerge(mapField, mapField)).toEqualTypeOf<FunctionCall<MapType<MapFields>>>();
    expectTypeOf(mapRemove(mapField, stringField)).toEqualTypeOf<
      FunctionCall<MapType<MapFields>>
    >();
    expectTypeOf(mapSet(mapField, stringField, intField)).toEqualTypeOf<
      FunctionCall<MapType<MapFields>>
    >();
  });

  it('ifAbsent — loose typing (TODO)', () => {
    ifAbsent(stringField, stringField);
  });

  it('rejects non-map inputs', () => {
    // @ts-expect-error
    mapGet(stringField, stringField);
    // @ts-expect-error
    mapKeys(intField);
  });
});

// =============================================================================
// Vector
// =============================================================================

describe('vector operators', () => {
  it('distance ops return DoubleType', () => {
    expectTypeOf(cosineDistance(vectorField, vectorField)).toEqualTypeOf<
      FunctionCall<DoubleType>
    >();
    expectTypeOf(dotProduct(vectorField, vectorField)).toEqualTypeOf<FunctionCall<DoubleType>>();
    expectTypeOf(euclideanDistance(vectorField, vectorField)).toEqualTypeOf<
      FunctionCall<DoubleType>
    >();
  });

  it('vectorLength returns Int64Type', () => {
    expectTypeOf(vectorLength(vectorField)).toEqualTypeOf<FunctionCall<Int64Type>>();
  });

  it('rejects non-vector inputs', () => {
    // @ts-expect-error
    cosineDistance(stringField, vectorField);
    // @ts-expect-error
    vectorLength(intField);
  });
});

// =============================================================================
// Timestamp
// =============================================================================

describe('timestamp operators', () => {
  it('currentTimestamp takes no args, returns TimestampType', () => {
    expectTypeOf(currentTimestamp()).toEqualTypeOf<FunctionCall<TimestampType>>();
  });

  it('timestampAdd / Subtract accept TimeUnit literal or Expression<StringType>', () => {
    expectTypeOf(timestampAdd(timestampField, 'day', intField)).toEqualTypeOf<
      FunctionCall<TimestampType>
    >();
    timestampAdd(timestampField, 'hour', doubleField);
    timestampAdd(timestampField, stringField, intField); // Expression form
    timestampSubtract(timestampField, 'minute', intField);
    timestampSubtract(timestampField, stringField, intField);
  });

  it('timestampTruncate accepts TimeGranularity literal or Expression<StringType>', () => {
    expectTypeOf(timestampTruncate(timestampField, 'day')).toEqualTypeOf<
      FunctionCall<TimestampType>
    >();
    timestampTruncate(timestampField, 'isoWeek');
    timestampTruncate(timestampField, 'week(monday)');
    timestampTruncate(timestampField, 'quarter');
    timestampTruncate(timestampField, stringField);
  });

  it('rejects invalid unit / granularity literals', () => {
    // @ts-expect-error 'fortnight' is not a TimeUnit
    timestampAdd(timestampField, 'fortnight', intField);
    // @ts-expect-error 'month' is not a TimeUnit (only TimeGranularity)
    timestampAdd(timestampField, 'month', intField);
    // @ts-expect-error 'eon' is not a TimeGranularity
    timestampTruncate(timestampField, 'eon');
  });

  it('timestampToUnix* return Int64Type', () => {
    expectTypeOf(timestampToUnixMicros(timestampField)).toEqualTypeOf<FunctionCall<Int64Type>>();
    expectTypeOf(timestampToUnixMillis(timestampField)).toEqualTypeOf<FunctionCall<Int64Type>>();
    expectTypeOf(timestampToUnixSeconds(timestampField)).toEqualTypeOf<FunctionCall<Int64Type>>();
  });

  it('unix*ToTimestamp return TimestampType', () => {
    expectTypeOf(unixMicrosToTimestamp(intField)).toEqualTypeOf<FunctionCall<TimestampType>>();
    expectTypeOf(unixMillisToTimestamp(doubleField)).toEqualTypeOf<FunctionCall<TimestampType>>();
    expectTypeOf(unixSecondsToTimestamp(intField)).toEqualTypeOf<FunctionCall<TimestampType>>();
  });
});

// =============================================================================
// Type checks / introspection
// =============================================================================

describe('type checks / introspection', () => {
  it('isType accepts a FieldTypeName literal or an Expression<StringType>', () => {
    expectTypeOf(isType(stringField, 'string')).toEqualTypeOf<FunctionCall<BoolType>>();
    isType(intField, 'int64');
    isType(stringField, stringField); // Expression form
  });

  it('isType rejects unknown type names', () => {
    // @ts-expect-error
    isType(stringField, 'unknown_type');
  });

  it('isError / isAbsent / exists return BoolType', () => {
    expectTypeOf(isError(stringField)).toEqualTypeOf<FunctionCall<BoolType>>();
    expectTypeOf(isAbsent(stringField)).toEqualTypeOf<FunctionCall<BoolType>>();
    expectTypeOf(exists(intField)).toEqualTypeOf<FunctionCall<BoolType>>();
  });

  it('type returns StringType', () => {
    expectTypeOf(type(stringField)).toEqualTypeOf<FunctionCall<StringType>>();
  });
});

// =============================================================================
// Control flow
// =============================================================================

describe('control flow', () => {
  it('conditional returns the branch type (then-side)', () => {
    expectTypeOf(conditional(boolField, stringField, stringField)).toEqualTypeOf<
      FunctionCall<StringType>
    >();
    expectTypeOf(conditional(boolField, intField, intField)).toEqualTypeOf<
      FunctionCall<Int64Type>
    >();
  });

  it('conditional rejects non-boolean condition', () => {
    // @ts-expect-error
    conditional(stringField, stringField, stringField);
  });

  it('ifError returns the try-branch type', () => {
    expectTypeOf(ifError(stringField, stringField)).toEqualTypeOf<FunctionCall<StringType>>();
    expectTypeOf(ifError(intField, intField)).toEqualTypeOf<FunctionCall<Int64Type>>();
  });
});

// =============================================================================
// Reference
// =============================================================================

describe('reference operators', () => {
  it('documentId / collectionId return StringType', () => {
    expectTypeOf(documentId(stringField)).toEqualTypeOf<FunctionCall<StringType>>();
    expectTypeOf(collectionId(stringField)).toEqualTypeOf<FunctionCall<StringType>>();
  });
});

// =============================================================================
// constant
// =============================================================================

describe('constant', () => {
  it('returns Constant<T> — T inferred from context (TODO: from value)', () => {
    expectTypeOf(constant<StringType>('hi')).toEqualTypeOf<Constant<StringType>>();
    expectTypeOf(constant<Int64Type>(42)).toEqualTypeOf<Constant<Int64Type>>();
  });

  it('works contextually in comparison call sites', () => {
    // T is inferred from `left`'s type at call site.
    equal(stringField, constant('hello'));
    equal(intField, constant(20));
  });
});
