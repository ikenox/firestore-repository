import {
  // TODO: schema.ts exports `array` / `map` as schema-type constructors, which collide
  // with the pipeline-level `array(...)` / `map({...})` expression factories below.
  // Currently imported under aliases. Decide on a long-term naming scheme.
  array as makeArrayType,
  type ArrayType,
  bool,
  type BoolType,
  type BytesType,
  double,
  type DoubleType,
  type FieldType,
  int64,
  type Int64Type,
  map as makeMapType,
  type MapFields,
  type MapType,
  string,
  type StringType,
  timestamp,
  type TimestampType,
  type VectorType,
} from '../schema.js';

export type Expression<T extends FieldType = FieldType> = FunctionCall<T> | Constant<T> | Field<T>;

export type Field<T extends FieldType = FieldType, Path extends string = string> = {
  type: T;
  path: Path;
};

export type Constant<T extends FieldType> = {
  kind: 'constant';
  type: T;
  value: unknown; // TODO add type
};

export type FunctionCall<T extends FieldType = FieldType> = {
  kind: 'functionCall';
  name: string;
  type: T;
  args: readonly Expression[];
};

/** Convenience union for numeric expression inputs. */
type NumericType = Int64Type | DoubleType;

/** Time units accepted by `timestampAdd` / `timestampSubtract`. */
export type TimeUnit = 'microsecond' | 'millisecond' | 'second' | 'minute' | 'hour' | 'day';

/** Granularities accepted by `timestampTruncate`. Superset of {@link TimeUnit}. */
export type TimeGranularity =
  | TimeUnit
  | 'week'
  | 'week(monday)'
  | 'week(tuesday)'
  | 'week(wednesday)'
  | 'week(thursday)'
  | 'week(friday)'
  | 'week(saturday)'
  | 'week(sunday)'
  | 'isoWeek'
  | 'month'
  | 'quarter'
  | 'year'
  | 'isoYear';

/** Field type names accepted by `isType`. Mirrors the backend's `Type` enum. */
export type FieldTypeName =
  | 'null'
  | 'array'
  | 'boolean'
  | 'bytes'
  | 'timestamp'
  | 'geo_point'
  | 'number'
  | 'int32'
  | 'int64'
  | 'float64'
  | 'decimal128'
  | 'map'
  | 'reference'
  | 'string'
  | 'vector'
  | 'max_key'
  | 'min_key'
  | 'object_id'
  | 'regex'
  | 'request_timestamp';

const fn = <T extends FieldType>(
  name: string,
  type: T,
  args: readonly Expression[],
): FunctionCall<T> => ({ kind: 'functionCall', name, type, args });

/** Wraps a string literal as a `Constant<StringType>` so it can be used as an arg. */
const stringConstant = (value: string): Constant<StringType> => ({
  kind: 'constant',
  type: string(),
  value,
});

/**
 * Accepts either a string literal or an `Expression<StringType>` and returns the
 * Expression form (string literals are wrapped as `stringConstant`). Mirrors the
 * official SDK's `valueToDefaultExpr` behavior for string args.
 */
const asStringExpr = (value: string | Expression<StringType>): Expression<StringType> =>
  typeof value === 'string' ? stringConstant(value) : value;

export const constant = <T extends FieldType>(value: unknown): Constant<T> => ({
  kind: 'constant',
  // TODO: derive the schema type from `value` (e.g. number -> DoubleType, string -> StringType).
  type: 'todo' as unknown as T,
  value,
});

// ---------------------------------------------------------------------------
// Comparison (return BoolType)
// ---------------------------------------------------------------------------

// Each comparison op has two overloads:
//   1) numeric-pair: `(Expression<NumericType>, Expression<NumericType>)` — lets Int64
//      and Double mix freely while still rejecting numeric-vs-other-group calls.
//   2) generic same-T: `<T extends FieldType>(Expression<T>, Expression<T>)` — covers
//      every other group plus the union-vs-narrow widening case.

export function equal(
  left: Expression<NumericType>,
  right: Expression<NumericType>,
): FunctionCall<BoolType>;
export function equal<T extends FieldType>(
  left: Expression<T>,
  right: Expression<T>,
): FunctionCall<BoolType>;
export function equal(left: Expression, right: Expression): FunctionCall<BoolType> {
  return fn('equal', bool(), [left, right]);
}

export function notEqual(
  left: Expression<NumericType>,
  right: Expression<NumericType>,
): FunctionCall<BoolType>;
export function notEqual<T extends FieldType>(
  left: Expression<T>,
  right: Expression<T>,
): FunctionCall<BoolType>;
export function notEqual(left: Expression, right: Expression): FunctionCall<BoolType> {
  return fn('notEqual', bool(), [left, right]);
}

export function lessThan(
  left: Expression<NumericType>,
  right: Expression<NumericType>,
): FunctionCall<BoolType>;
export function lessThan<T extends FieldType>(
  left: Expression<T>,
  right: Expression<T>,
): FunctionCall<BoolType>;
export function lessThan(left: Expression, right: Expression): FunctionCall<BoolType> {
  return fn('lessThan', bool(), [left, right]);
}

export function lessThanOrEqual(
  left: Expression<NumericType>,
  right: Expression<NumericType>,
): FunctionCall<BoolType>;
export function lessThanOrEqual<T extends FieldType>(
  left: Expression<T>,
  right: Expression<T>,
): FunctionCall<BoolType>;
export function lessThanOrEqual(left: Expression, right: Expression): FunctionCall<BoolType> {
  return fn('lessThanOrEqual', bool(), [left, right]);
}

export function greaterThan(
  left: Expression<NumericType>,
  right: Expression<NumericType>,
): FunctionCall<BoolType>;
export function greaterThan<T extends FieldType>(
  left: Expression<T>,
  right: Expression<T>,
): FunctionCall<BoolType>;
export function greaterThan(left: Expression, right: Expression): FunctionCall<BoolType> {
  return fn('greaterThan', bool(), [left, right]);
}

export function greaterThanOrEqual(
  left: Expression<NumericType>,
  right: Expression<NumericType>,
): FunctionCall<BoolType>;
export function greaterThanOrEqual<T extends FieldType>(
  left: Expression<T>,
  right: Expression<T>,
): FunctionCall<BoolType>;
export function greaterThanOrEqual(left: Expression, right: Expression): FunctionCall<BoolType> {
  return fn('greaterThanOrEqual', bool(), [left, right]);
}

export function equalAny(
  value: Expression<NumericType>,
  ...candidates: Expression<NumericType>[]
): FunctionCall<BoolType>;
export function equalAny<T extends FieldType>(
  value: Expression<T>,
  ...candidates: Expression<T>[]
): FunctionCall<BoolType>;
export function equalAny(value: Expression, ...candidates: Expression[]): FunctionCall<BoolType> {
  return fn('equalAny', bool(), [value, ...candidates]);
}

export function notEqualAny(
  value: Expression<NumericType>,
  ...candidates: Expression<NumericType>[]
): FunctionCall<BoolType>;
export function notEqualAny<T extends FieldType>(
  value: Expression<T>,
  ...candidates: Expression<T>[]
): FunctionCall<BoolType>;
export function notEqualAny(
  value: Expression,
  ...candidates: Expression[]
): FunctionCall<BoolType> {
  return fn('notEqualAny', bool(), [value, ...candidates]);
}

// ---------------------------------------------------------------------------
// Logical (return BoolType)
// ---------------------------------------------------------------------------

export const and = (
  first: Expression<BoolType>,
  ...rest: Expression<BoolType>[]
): FunctionCall<BoolType> => fn('and', bool(), [first, ...rest]);

export const or = (
  first: Expression<BoolType>,
  ...rest: Expression<BoolType>[]
): FunctionCall<BoolType> => fn('or', bool(), [first, ...rest]);

export const not = (expr: Expression<BoolType>): FunctionCall<BoolType> =>
  fn('not', bool(), [expr]);

export const xor = (
  first: Expression<BoolType>,
  ...rest: Expression<BoolType>[]
): FunctionCall<BoolType> => fn('xor', bool(), [first, ...rest]);

// ---------------------------------------------------------------------------
// Arithmetic (return numeric; default DoubleType to keep things simple)
//
// TODO: refine return type for binary numeric ops based on input types.
//   - `add / subtract / multiply / mod`: Int64 + Int64 -> Int64; otherwise Double.
//   - `divide`: always Double (matches SDK / SQL semantics).
//   - `pow`: needs spec lookup — likely Double always.
//   - `abs / floor / ceil / round / trunc`: should preserve Int64 vs Double of the input.
//   - `sqrt / exp / ln / log`: always Double.
//   - `logicalMaximum / logicalMinimum`: union of input numeric types.
// Currently every op flattens to `DoubleType`, which is safe but loses precision info.
// Implement via per-op generic overload (Int64-pair overload + Double fallback).
// ---------------------------------------------------------------------------

export const add = (
  left: Expression<NumericType>,
  right: Expression<NumericType>,
): FunctionCall<DoubleType> => fn('add', double(), [left, right]);

export const subtract = (
  left: Expression<NumericType>,
  right: Expression<NumericType>,
): FunctionCall<DoubleType> => fn('subtract', double(), [left, right]);

export const multiply = (
  left: Expression<NumericType>,
  right: Expression<NumericType>,
): FunctionCall<DoubleType> => fn('multiply', double(), [left, right]);

export const divide = (
  left: Expression<NumericType>,
  right: Expression<NumericType>,
): FunctionCall<DoubleType> => fn('divide', double(), [left, right]);

export const mod = (
  left: Expression<NumericType>,
  right: Expression<NumericType>,
): FunctionCall<DoubleType> => fn('mod', double(), [left, right]);

export const abs = (value: Expression<NumericType>): FunctionCall<DoubleType> =>
  fn('abs', double(), [value]);

export const pow = (
  base: Expression<NumericType>,
  exponent: Expression<NumericType>,
): FunctionCall<DoubleType> => fn('pow', double(), [base, exponent]);

export const sqrt = (value: Expression<NumericType>): FunctionCall<DoubleType> =>
  fn('sqrt', double(), [value]);

export const exp = (value: Expression<NumericType>): FunctionCall<DoubleType> =>
  fn('exp', double(), [value]);

export const ln = (value: Expression<NumericType>): FunctionCall<DoubleType> =>
  fn('ln', double(), [value]);

export const log = (
  value: Expression<NumericType>,
  base: Expression<NumericType>,
): FunctionCall<DoubleType> => fn('log', double(), [value, base]);

export const floor = (value: Expression<NumericType>): FunctionCall<DoubleType> =>
  fn('floor', double(), [value]);

export const ceil = (value: Expression<NumericType>): FunctionCall<DoubleType> =>
  fn('ceil', double(), [value]);

export const round = (value: Expression<NumericType>): FunctionCall<DoubleType> =>
  fn('round', double(), [value]);

export const trunc = (value: Expression<NumericType>): FunctionCall<DoubleType> =>
  fn('trunc', double(), [value]);

export const rand = (): FunctionCall<DoubleType> => fn('rand', double(), []);

export const logicalMaximum = (
  first: Expression<NumericType>,
  ...rest: Expression<NumericType>[]
): FunctionCall<DoubleType> => fn('logicalMaximum', double(), [first, ...rest]);

export const logicalMinimum = (
  first: Expression<NumericType>,
  ...rest: Expression<NumericType>[]
): FunctionCall<DoubleType> => fn('logicalMinimum', double(), [first, ...rest]);

// ---------------------------------------------------------------------------
// String
// ---------------------------------------------------------------------------

export const toUpper = (s: Expression<StringType>): FunctionCall<StringType> =>
  fn('toUpper', string(), [s]);

export const toLower = (s: Expression<StringType>): FunctionCall<StringType> =>
  fn('toLower', string(), [s]);

export const trim = (s: Expression<StringType>): FunctionCall<StringType> =>
  fn('trim', string(), [s]);

export const ltrim = (s: Expression<StringType>): FunctionCall<StringType> =>
  fn('ltrim', string(), [s]);

export const rtrim = (s: Expression<StringType>): FunctionCall<StringType> =>
  fn('rtrim', string(), [s]);

export const charLength = (s: Expression<StringType>): FunctionCall<Int64Type> =>
  fn('charLength', int64(), [s]);

export const byteLength = (s: Expression<StringType | BytesType>): FunctionCall<Int64Type> =>
  fn('byteLength', int64(), [s]);

export const substring = (
  s: Expression<StringType>,
  start: Expression<NumericType>,
  length?: Expression<NumericType>,
): FunctionCall<StringType> =>
  fn('substring', string(), length === undefined ? [s, start] : [s, start, length]);

export const concat = (
  first: Expression<StringType>,
  ...rest: Expression<StringType>[]
): FunctionCall<StringType> => fn('concat', string(), [first, ...rest]);

export const stringConcat = (
  first: Expression<StringType>,
  ...rest: Expression<StringType>[]
): FunctionCall<StringType> => fn('stringConcat', string(), [first, ...rest]);

export const startsWith = (
  s: Expression<StringType>,
  prefix: string | Expression<StringType>,
): FunctionCall<BoolType> => fn('startsWith', bool(), [s, asStringExpr(prefix)]);

export const endsWith = (
  s: Expression<StringType>,
  suffix: string | Expression<StringType>,
): FunctionCall<BoolType> => fn('endsWith', bool(), [s, asStringExpr(suffix)]);

export const like = (
  s: Expression<StringType>,
  pattern: string | Expression<StringType>,
): FunctionCall<BoolType> => fn('like', bool(), [s, asStringExpr(pattern)]);

export const stringContains = (
  s: Expression<StringType>,
  substr: string | Expression<StringType>,
): FunctionCall<BoolType> => fn('stringContains', bool(), [s, asStringExpr(substr)]);

// TODO: SDK also accepts a `Bytes` literal for `search`; only String form auto-wrapped.
export const stringIndexOf = (
  s: Expression<StringType>,
  search: string | Expression<StringType | BytesType>,
): FunctionCall<Int64Type> =>
  fn('stringIndexOf', int64(), [s, typeof search === 'string' ? stringConstant(search) : search]);

export const stringRepeat = (
  s: Expression<StringType>,
  times: Expression<NumericType>,
): FunctionCall<StringType> => fn('stringRepeat', string(), [s, times]);

export const stringReverse = (s: Expression<StringType>): FunctionCall<StringType> =>
  fn('stringReverse', string(), [s]);

export const stringReplaceOne = (
  s: Expression<StringType>,
  search: string | Expression<StringType>,
  replacement: string | Expression<StringType>,
): FunctionCall<StringType> =>
  fn('stringReplaceOne', string(), [s, asStringExpr(search), asStringExpr(replacement)]);

export const stringReplaceAll = (
  s: Expression<StringType>,
  search: string | Expression<StringType>,
  replacement: string | Expression<StringType>,
): FunctionCall<StringType> =>
  fn('stringReplaceAll', string(), [s, asStringExpr(search), asStringExpr(replacement)]);

export const regexMatch = (
  s: Expression<StringType>,
  pattern: string | Expression<StringType>,
): FunctionCall<BoolType> => fn('regexMatch', bool(), [s, asStringExpr(pattern)]);

export const regexContains = (
  s: Expression<StringType>,
  pattern: string | Expression<StringType>,
): FunctionCall<BoolType> => fn('regexContains', bool(), [s, asStringExpr(pattern)]);

export const regexFind = (
  s: Expression<StringType>,
  pattern: string | Expression<StringType>,
): FunctionCall<StringType> => fn('regexFind', string(), [s, asStringExpr(pattern)]);

export const regexFindAll = (
  s: Expression<StringType>,
  pattern: string | Expression<StringType>,
): FunctionCall<ArrayType<StringType, [], []>> =>
  fn('regexFindAll', makeArrayType(string()), [s, asStringExpr(pattern)]);

export const split = (
  s: Expression<StringType>,
  delimiter: string | Expression<StringType>,
): FunctionCall<ArrayType<StringType, [], []>> =>
  fn('split', makeArrayType(string()), [s, asStringExpr(delimiter)]);

export const join = (
  arr: Expression<ArrayType>,
  separator: string | Expression<StringType>,
): FunctionCall<StringType> => fn('join', string(), [arr, asStringExpr(separator)]);

// ---------------------------------------------------------------------------
// Array
// ---------------------------------------------------------------------------

// TODO: refine element typing — currently treats every element as untyped `Expression`.
export const array = (...elements: Expression[]): FunctionCall<ArrayType> =>
  fn('array', makeArrayType(string()) as ArrayType, elements);

export const arrayLength = (arr: Expression<ArrayType>): FunctionCall<Int64Type> =>
  fn('arrayLength', int64(), [arr]);

// TODO: index-aware return type would require array element type tracking.
export const arrayGet = (
  arr: Expression<ArrayType>,
  index: Expression<NumericType>,
): FunctionCall<FieldType> => fn('arrayGet', string() as FieldType, [arr, index]);

export const arrayConcat = (
  first: Expression<ArrayType>,
  ...rest: Expression<ArrayType>[]
): FunctionCall<ArrayType> =>
  fn('arrayConcat', makeArrayType(string()) as ArrayType, [first, ...rest]);

export const arrayContains = <T extends FieldType>(
  arr: Expression<ArrayType<T>>,
  value: Expression<T>,
): FunctionCall<BoolType> => fn('arrayContains', bool(), [arr, value]);

export const arrayContainsAll = <T extends FieldType>(
  arr: Expression<ArrayType<T>>,
  values: Expression<ArrayType<T>>,
): FunctionCall<BoolType> => fn('arrayContainsAll', bool(), [arr, values]);

export const arrayContainsAny = <T extends FieldType>(
  arr: Expression<ArrayType<T>>,
  values: Expression<ArrayType<T>>,
): FunctionCall<BoolType> => fn('arrayContainsAny', bool(), [arr, values]);

export const reverse = <T extends ArrayType>(arr: Expression<T>): FunctionCall<T> =>
  fn('reverse', arr.type, [arr]);

// ---------------------------------------------------------------------------
// Map
// TODO: most map operators are typed loosely because element-level types depend on the key.
// ---------------------------------------------------------------------------

export const map = (entries: Record<string, Expression>): FunctionCall<MapType<MapFields>> => {
  const args: Expression[] = [];
  for (const [k, v] of Object.entries(entries)) {
    args.push(stringConstant(k), v);
  }
  return fn('map', makeMapType({}) as MapType<MapFields>, args);
};

export const mapGet = (
  m: Expression<MapType>,
  key: string | Expression<StringType>,
): FunctionCall<FieldType> => fn('mapGet', string() as FieldType, [m, asStringExpr(key)]);

export const mapEntries = (m: Expression<MapType>): FunctionCall<ArrayType> =>
  fn('mapEntries', makeArrayType(string()) as ArrayType, [m]);

export const mapKeys = (m: Expression<MapType>): FunctionCall<ArrayType<StringType, [], []>> =>
  fn('mapKeys', makeArrayType(string()), [m]);

export const mapValues = (m: Expression<MapType>): FunctionCall<ArrayType> =>
  fn('mapValues', makeArrayType(string()) as ArrayType, [m]);

export const mapMerge = (
  first: Expression<MapType>,
  ...rest: Expression<MapType>[]
): FunctionCall<MapType<MapFields>> =>
  fn('mapMerge', makeMapType({}) as MapType<MapFields>, [first, ...rest]);

export const mapRemove = (
  m: Expression<MapType>,
  key: string | Expression<StringType>,
): FunctionCall<MapType<MapFields>> =>
  fn('mapRemove', makeMapType({}) as MapType<MapFields>, [m, asStringExpr(key)]);

export const mapSet = (
  m: Expression<MapType>,
  key: string | Expression<StringType>,
  value: Expression,
): FunctionCall<MapType<MapFields>> =>
  fn('mapSet', makeMapType({}) as MapType<MapFields>, [m, asStringExpr(key), value]);

// TODO: figure out the proper signature — official SDK has `ifAbsent(field, alternative)`
// and behaves like coalesce. Loose-typed for now.
export const ifAbsent = (value: Expression, alternative: Expression): FunctionCall =>
  fn('ifAbsent', string() as FieldType, [value, alternative]);

// ---------------------------------------------------------------------------
// Vector
// ---------------------------------------------------------------------------

export const cosineDistance = (
  left: Expression<VectorType>,
  right: Expression<VectorType>,
): FunctionCall<DoubleType> => fn('cosineDistance', double(), [left, right]);

export const dotProduct = (
  left: Expression<VectorType>,
  right: Expression<VectorType>,
): FunctionCall<DoubleType> => fn('dotProduct', double(), [left, right]);

export const euclideanDistance = (
  left: Expression<VectorType>,
  right: Expression<VectorType>,
): FunctionCall<DoubleType> => fn('euclideanDistance', double(), [left, right]);

export const vectorLength = (v: Expression<VectorType>): FunctionCall<Int64Type> =>
  fn('vectorLength', int64(), [v]);

// ---------------------------------------------------------------------------
// Timestamp
// ---------------------------------------------------------------------------

export const currentTimestamp = (): FunctionCall<TimestampType> =>
  fn('currentTimestamp', timestamp(), []);

export const timestampAdd = (
  ts: Expression<TimestampType>,
  unit: TimeUnit | Expression<StringType>,
  amount: Expression<NumericType>,
): FunctionCall<TimestampType> =>
  fn('timestampAdd', timestamp(), [
    ts,
    typeof unit === 'string' ? stringConstant(unit) : unit,
    amount,
  ]);

export const timestampSubtract = (
  ts: Expression<TimestampType>,
  unit: TimeUnit | Expression<StringType>,
  amount: Expression<NumericType>,
): FunctionCall<TimestampType> =>
  fn('timestampSubtract', timestamp(), [
    ts,
    typeof unit === 'string' ? stringConstant(unit) : unit,
    amount,
  ]);

export const timestampTruncate = (
  ts: Expression<TimestampType>,
  granularity: TimeGranularity | Expression<StringType>,
): FunctionCall<TimestampType> =>
  fn('timestampTruncate', timestamp(), [
    ts,
    typeof granularity === 'string' ? stringConstant(granularity) : granularity,
  ]);

export const timestampToUnixMicros = (ts: Expression<TimestampType>): FunctionCall<Int64Type> =>
  fn('timestampToUnixMicros', int64(), [ts]);

export const timestampToUnixMillis = (ts: Expression<TimestampType>): FunctionCall<Int64Type> =>
  fn('timestampToUnixMillis', int64(), [ts]);

export const timestampToUnixSeconds = (ts: Expression<TimestampType>): FunctionCall<Int64Type> =>
  fn('timestampToUnixSeconds', int64(), [ts]);

export const unixMicrosToTimestamp = (
  micros: Expression<NumericType>,
): FunctionCall<TimestampType> => fn('unixMicrosToTimestamp', timestamp(), [micros]);

export const unixMillisToTimestamp = (
  millis: Expression<NumericType>,
): FunctionCall<TimestampType> => fn('unixMillisToTimestamp', timestamp(), [millis]);

export const unixSecondsToTimestamp = (
  seconds: Expression<NumericType>,
): FunctionCall<TimestampType> => fn('unixSecondsToTimestamp', timestamp(), [seconds]);

// ---------------------------------------------------------------------------
// Type checks / introspection
// ---------------------------------------------------------------------------

export const isType = (
  value: Expression,
  typeName: FieldTypeName | Expression<StringType>,
): FunctionCall<BoolType> =>
  fn('isType', bool(), [value, typeof typeName === 'string' ? stringConstant(typeName) : typeName]);

export const isError = (value: Expression): FunctionCall<BoolType> =>
  fn('isError', bool(), [value]);

export const isAbsent = (value: Expression): FunctionCall<BoolType> =>
  fn('isAbsent', bool(), [value]);

export const exists = (value: Expression): FunctionCall<BoolType> => fn('exists', bool(), [value]);

export const type = (value: Expression): FunctionCall<StringType> => fn('type', string(), [value]);

// ---------------------------------------------------------------------------
// Control flow
// TODO: propagate the branch type — currently the return tracks `then`'s type only.
// ---------------------------------------------------------------------------

export const conditional = <T extends FieldType>(
  cond: Expression<BoolType>,
  thenExpr: Expression<T>,
  elseExpr: Expression<T>,
): FunctionCall<T> => fn('conditional', thenExpr.type, [cond, thenExpr, elseExpr]);

export const ifError = <T extends FieldType>(
  tryExpr: Expression<T>,
  catchExpr: Expression<T>,
): FunctionCall<T> => fn('ifError', tryExpr.type, [tryExpr, catchExpr]);

// ---------------------------------------------------------------------------
// Reference
// TODO: model docRef arg properly once docRef expression typing is settled.
// ---------------------------------------------------------------------------

export const documentId = (ref: Expression): FunctionCall<StringType> =>
  fn('documentId', string(), [ref]);

export const collectionId = (ref: Expression): FunctionCall<StringType> =>
  fn('collectionId', string(), [ref]);
