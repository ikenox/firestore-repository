import { Bytes, doc, type Firestore, GeoPoint, vector } from '@firebase/firestore';
import {
  abs as sdkAbs,
  add as sdkAdd,
  and as sdkAnd,
  array as sdkArray,
  byteLength as sdkByteLength,
  ceil as sdkCeil,
  charLength as sdkCharLength,
  collectionId as sdkCollectionId,
  cosineDistance as sdkCosineDistance,
  constant as sdkConstant,
  divide as sdkDivide,
  documentId as sdkDocumentId,
  dotProduct as sdkDotProduct,
  endsWith as sdkEndsWith,
  equal as sdkEqual,
  euclideanDistance as sdkEuclideanDistance,
  execute as executePipeline,
  exp as sdkExp,
  field,
  floor as sdkFloor,
  greaterThan as sdkGreaterThan,
  greaterThanOrEqual as sdkGreaterThanOrEqual,
  isType as sdkIsType,
  lessThan as sdkLessThan,
  lessThanOrEqual as sdkLessThanOrEqual,
  like as sdkLike,
  ln as sdkLn,
  log10 as sdkLog10,
  ltrim as sdkLtrim,
  map as sdkMap,
  mapEntries as sdkMapEntries,
  mapGet as sdkMapGet,
  mapKeys as sdkMapKeys,
  mapMerge as sdkMapMerge,
  mapRemove as sdkMapRemove,
  mapSet as sdkMapSet,
  mapValues as sdkMapValues,
  mod as sdkMod,
  multiply as sdkMultiply,
  not as sdkNot,
  notEqual as sdkNotEqual,
  or as sdkOr,
  pow as sdkPow,
  arrayConcat as sdkArrayConcat,
  arrayContains as sdkArrayContains,
  arrayContainsAll as sdkArrayContainsAll,
  arrayContainsAny as sdkArrayContainsAny,
  arrayGet as sdkArrayGet,
  arrayLength as sdkArrayLength,
  conditional as sdkConditional,
  currentTimestamp as sdkCurrentTimestamp,
  equalAny as sdkEqualAny,
  exists as sdkExists,
  ifAbsent as sdkIfAbsent,
  ifError as sdkIfError,
  ifNull as sdkIfNull,
  isAbsent as sdkIsAbsent,
  isError as sdkIsError,
  logicalMaximum as sdkLogicalMaximum,
  logicalMinimum as sdkLogicalMinimum,
  notEqualAny as sdkNotEqualAny,
  xor as sdkXor,
  rand as sdkRand,
  timestampAdd as sdkTimestampAdd,
  timestampDiff as sdkTimestampDiff,
  timestampExtract as sdkTimestampExtract,
  timestampSubtract as sdkTimestampSubtract,
  timestampToUnixMicros as sdkTimestampToUnixMicros,
  timestampToUnixMillis as sdkTimestampToUnixMillis,
  timestampToUnixSeconds as sdkTimestampToUnixSeconds,
  timestampTruncate as sdkTimestampTruncate,
  unixMicrosToTimestamp as sdkUnixMicrosToTimestamp,
  unixMillisToTimestamp as sdkUnixMillisToTimestamp,
  unixSecondsToTimestamp as sdkUnixSecondsToTimestamp,
  regexContains as sdkRegexContains,
  regexFind as sdkRegexFind,
  regexFindAll as sdkRegexFindAll,
  regexMatch as sdkRegexMatch,
  round as sdkRound,
  rtrim as sdkRtrim,
  sqrt as sdkSqrt,
  startsWith as sdkStartsWith,
  stringConcat as sdkStringConcat,
  stringContains as sdkStringContains,
  stringIndexOf as sdkStringIndexOf,
  stringRepeat as sdkStringRepeat,
  stringReplaceAll as sdkStringReplaceAll,
  stringReplaceOne as sdkStringReplaceOne,
  stringReverse as sdkStringReverse,
  substring as sdkSubstring,
  subtract as sdkSubtract,
  toLower as sdkToLower,
  toUpper as sdkToUpper,
  trim as sdkTrim,
  trunc as sdkTrunc,
  type as sdkType,
  vectorLength as sdkVectorLength,
  countAll as sdkCountAll,
  count as sdkCount,
  countDistinct as sdkCountDistinct,
  countIf as sdkCountIf,
  sum as sdkSum,
  average as sdkAverage,
  minimum as sdkMinimum,
  maximum as sdkMaximum,
  first as sdkFirst,
  last as sdkLast,
  arrayAgg as sdkArrayAgg,
  arrayAggDistinct as sdkArrayAggDistinct,
  type AggregateFunction as SdkAggregateFunction,
  type Expression as SdkExpression,
  type Pipeline as SdkPipeline,
  type Selectable as SdkSelectable,
} from '@firebase/firestore/pipelines';
import { collectionPath } from 'firestore-repository/path';
import {
  type Constant,
  type ConstantArray,
  type Expression,
  DocRefValue,
  GeoPointValue,
  VectorValue,
  ExpressionWithAlias,
  type AggregateFunctionName,
  type AggregatePayload,
  type FunctionName,
  type FunctionPayload,
} from 'firestore-repository/pipelines/expression';
import type { Ordering } from 'firestore-repository/pipelines/ordering';
import type {
  Pipeline,
  PipelineQueryExecutor,
  PipelineResult,
  PipelineRowIdentity,
} from 'firestore-repository/pipelines/pipeline';
import type { TransformStage } from 'firestore-repository/pipelines/stage';
import type { Collection, DocumentSchema } from 'firestore-repository/schema';
import { assertNever } from 'firestore-repository/util';

import { buildDecodeSchema } from './codec.js';
import { buildFirestoreUtilities } from './index.js';

/**
 * Builds a {@link PipelineQueryExecutor} backed by the `@firebase/firestore`
 * client SDK (Enterprise edition). It walks the repository's `Pipeline` AST into
 * `db.pipeline()...` and runs it via the SDK's `execute`.
 *
 * Implemented so far: `collection` / `collectionGroup` inputs plus `sort`.
 * Other inputs / stages throw.
 */
export const executor = (db: Firestore): PipelineQueryExecutor => {
  const execute = async <Schema extends DocumentSchema, Id extends PipelineRowIdentity>(
    pipeline: Pipeline<Schema, Id>,
  ): Promise<PipelineResult<Schema, Id>[]> => {
    const { input, transforms } = pipeline.stages();
    let collection: Collection;
    let sdk: SdkPipeline;
    switch (input.kind) {
      case 'collection':
        collection = input.collection;
        sdk = db.pipeline().collection(collectionPath(collection, input.parent));
        break;
      case 'collectionGroup':
        collection = input.collection;
        sdk = db.pipeline().collectionGroup(collection.name);
        break;
      case 'database':
      case 'documents':
      case 'literals':
        throw new Error(
          `firebase pipeline executor: input stage "${input.kind}" not supported yet`,
        );
      default:
        return assertNever(input);
    }
    for (const stage of transforms) {
      sdk = applyStage(db, sdk, stage);
    }

    const { fromFirestore } = buildFirestoreUtilities(db, collection);
    // Rows are decoded with the pipeline's FINAL schema (the leaf node's), not
    // the source collection's — stages like `select` reshape the rows.
    const decodeRow = buildDecodeSchema(pipeline.node.schema);
    const snapshot = await executePipeline(sdk);
    return snapshot.results.map((r) => {
      const data = decodeRow.parse(r.data());
      const id = r.ref ? fromFirestore.docRef(r.ref) : undefined;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `data`/`id` are runtime values matching the caller's Schema/Id, which the compiler cannot prove here
      return (id === undefined ? { data } : { data, id }) as PipelineResult<Schema, Id>;
    });
  };
  return { execute };
};

const applyStage = (db: Firestore, sdk: SdkPipeline, stage: TransformStage): SdkPipeline => {
  switch (stage.kind) {
    case 'sort': {
      const [first, ...rest] = stage.orderings.map(toSdkOrdering);
      return first === undefined ? sdk : sdk.sort(first, ...rest);
    }
    case 'select': {
      const [first, ...rest] = stage.selections.map((selection) => toSdkSelectable(db, selection));
      if (first === undefined) {
        throw new Error('firebase pipeline executor: select requires at least one selection');
      }
      return sdk.select(first, ...rest);
    }
    case 'removeFields': {
      const [first, ...rest] = stage.fields;
      if (first === undefined) {
        throw new Error('firebase pipeline executor: removeFields requires at least one field');
      }
      return sdk.removeFields(first, ...rest);
    }
    case 'addFields': {
      const [first, ...rest] = stage.selections.map((selection) => toSdkSelectable(db, selection));
      if (first === undefined) {
        throw new Error('firebase pipeline executor: addFields requires at least one field');
      }
      return sdk.addFields(first, ...rest);
    }
    case 'aggregate': {
      // Always the options-object form (uniform; the variadic accumulator form
      // is client sugar). `accumulators` are the aliased accumulator calls;
      // `groups` translate like `select` selections — a bare path becomes a
      // `Field`, an aliased expression becomes the translated expression `.as`.
      const accumulators = stage.accumulators.map(({ aggregate, alias }) =>
        dispatchAggregate(aggregate.call, (e) => toSdkExpression(db, e)).as(alias),
      );
      const groups = stage.groups.map((selection) => toSdkSelectable(db, selection));
      return sdk.aggregate({ accumulators, groups });
    }
    case 'distinct': {
      // A grouped aggregate with zero accumulators — the options-object form
      // takes `groups`, translated exactly like the aggregate arm's groups.
      const groups = stage.groups.map((selection) => toSdkSelectable(db, selection));
      return sdk.distinct({ groups });
    }
    case 'where':
      // `asBoolean()` is a type-tag wrap for the SDK's `BooleanExpression`
      // parameter — it does not change the wire proto.
      return sdk.where(toSdkExpression(db, stage.condition).asBoolean());
    case 'limit':
      return sdk.limit(stage.limit);
    case 'offset':
      return sdk.offset(stage.offset);
    case 'unnest':
    case 'replaceWith':
    case 'union':
    case 'findNearest':
    case 'let':
    case 'search':
    case 'sample':
      throw new Error(`firebase pipeline executor: stage "${stage.kind}" not supported yet`);
    default:
      return assertNever(stage);
  }
};

/**
 * Translates a selection (bare path or aliased expression) into an SDK
 * selectable. A bare path becomes a `Field`, which implements `Selectable`
 * with its own path as the alias — the same wire proto as the SDK's string
 * handling for `select`, in the form `addFields` also accepts.
 */
const toSdkSelectable = (db: Firestore, s: string | ExpressionWithAlias): SdkSelectable =>
  typeof s === 'string' ? field(s) : toSdkExpression(db, s.expression).as(s.alias);

/**
 * Translates the repository expression AST into an SDK expression. Threads
 * `db` for the one value kind whose SDK form needs it: a document-reference
 * constant is built via `doc(db, ...)` (the codec's `buildEncodeField`
 * precedent).
 */
const toSdkExpression = (db: Firestore, expression: Expression): SdkExpression => {
  switch (expression.kind) {
    case 'field':
      return field(expression.path);
    case 'constant':
      return toSdkConstant(db, expression.value);
    case 'functionCall':
      return dispatch(expression.call, (e) => toSdkExpression(db, e));
    default:
      return assertNever(expression);
  }
};

/**
 * Recursively translates a constant value tree into SDK expressions —
 * composites translate node-wise (the SDK's `array()` / `map()` accept
 * nested expressions), so conversions like `Uint8Array` → `Bytes` apply at
 * any depth. `Constant` payload shapes are unambiguous: geopoints and
 * vectors are dedicated nodes, so an array is always an array constant and a
 * plain object always a map constant.
 */
const toSdkConstant = (db: Firestore, value: Constant['value']): SdkExpression => {
  if (value === null) {
    return sdkConstant(value);
  }
  if (value instanceof Date) {
    return sdkConstant(value);
  }
  if (value instanceof Uint8Array) {
    return sdkConstant(Bytes.fromUint8Array(value));
  }
  if (value instanceof GeoPointValue) {
    return sdkConstant(new GeoPoint(value.latitude, value.longitude));
  }
  if (value instanceof VectorValue) {
    return sdkConstant(vector([...value.values]));
  }
  if (value instanceof DocRefValue) {
    return sdkConstant(doc(db, value.path.join('/')));
  }
  if (isConstantArrayValue(value)) {
    return sdkArray(value.map((element) => toSdkConstant(db, element)));
  }
  switch (typeof value) {
    case 'string':
      return sdkConstant(value);
    case 'number':
      return sdkConstant(value);
    case 'boolean':
      return sdkConstant(value);
    case 'object':
      return sdkMap(
        Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toSdkConstant(db, v)])),
      );
    case 'bigint':
    case 'symbol':
    case 'undefined':
    case 'function':
      // Impossible for a ConstantValue — `value` is narrowed to `never` here.
      return assertNever(value);
    default:
      return assertNever(value);
  }
};

/** `Array.isArray` narrows poorly over readonly-array unions — a dedicated guard does. */
const isConstantArrayValue = (value: Constant['value']): value is ConstantArray =>
  Array.isArray(value);

/**
 * Dispatches a function-call payload to its translator. The generic `K` ties
 * the payload's `name` to the matching translator entry: TS cannot correlate a
 * whole-union table index (`functionTranslators[call.name](call, ...)`) against
 * the whole-union payload on its own, but a single type variable lets the
 * mapped-type access `functionTranslators[K]` line up with the narrowed
 * `Extract<FunctionPayload, { name: K }>` argument — so no assertion is needed.
 */
const dispatch = <K extends FunctionName>(
  call: Extract<FunctionPayload, { name: K }>,
  t: (e: Expression) => SdkExpression,
): SdkExpression => functionTranslators[call.name](call, t);

/**
 * One translator per function name: a `Record`-like mapped type over the name
 * union requires every key, so a newly added function fails to compile here
 * until translated. Each entry receives its NARROWED payload (typed named
 * operands, literal fields as plain values) and `t`, the recursive translator
 * for operand expressions.
 *
 * (`asBoolean()` wraps satisfy the SDK's `BooleanExpression` parameters — a
 * type-tag only, no wire change.)
 */
type FunctionTranslators = {
  [K in FunctionName]: (
    call: Extract<FunctionPayload, { name: K }>,
    t: (e: Expression) => SdkExpression,
  ) => SdkExpression;
};

const functionTranslators: FunctionTranslators = {
  // logical
  and: (c, t) => {
    const [f, s, ...r] = c.conditions;
    return sdkAnd(t(f).asBoolean(), t(s).asBoolean(), ...r.map((e) => t(e).asBoolean()));
  },
  or: (c, t) => {
    const [f, s, ...r] = c.conditions;
    return sdkOr(t(f).asBoolean(), t(s).asBoolean(), ...r.map((e) => t(e).asBoolean()));
  },
  xor: (c, t) => {
    const [f, s, ...r] = c.conditions;
    return sdkXor(t(f).asBoolean(), t(s).asBoolean(), ...r.map((e) => t(e).asBoolean()));
  },
  not: (c, t) => sdkNot(t(c.condition).asBoolean()),
  // comparison
  equal: (c, t) => sdkEqual(t(c.left), t(c.right)),
  notEqual: (c, t) => sdkNotEqual(t(c.left), t(c.right)),
  lessThan: (c, t) => sdkLessThan(t(c.left), t(c.right)),
  lessThanOrEqual: (c, t) => sdkLessThanOrEqual(t(c.left), t(c.right)),
  greaterThan: (c, t) => sdkGreaterThan(t(c.left), t(c.right)),
  greaterThanOrEqual: (c, t) => sdkGreaterThanOrEqual(t(c.left), t(c.right)),
  // The SDK declares an (Expression, arrayExpression: Expression) overload —
  // pass the translated array-typed operand directly.
  equalAny: (c, t) => sdkEqualAny(t(c.value), t(c.options)),
  notEqualAny: (c, t) => sdkNotEqualAny(t(c.value), t(c.options)),
  // conditional & extremes
  conditional: (c, t) => sdkConditional(t(c.condition).asBoolean(), t(c.thenExpr), t(c.elseExpr)),
  logicalMaximum: (c, t) => {
    const [f, s, ...r] = c.operands;
    return sdkLogicalMaximum(t(f), t(s), ...r.map(t));
  },
  logicalMinimum: (c, t) => {
    const [f, s, ...r] = c.operands;
    return sdkLogicalMinimum(t(f), t(s), ...r.map(t));
  },
  // arithmetic
  rand: () => sdkRand(),
  add: (c, t) => sdkAdd(t(c.left), t(c.right)),
  subtract: (c, t) => sdkSubtract(t(c.left), t(c.right)),
  multiply: (c, t) => sdkMultiply(t(c.left), t(c.right)),
  divide: (c, t) => sdkDivide(t(c.left), t(c.right)),
  mod: (c, t) => sdkMod(t(c.left), t(c.right)),
  pow: (c, t) => sdkPow(t(c.base), t(c.exponent)),
  abs: (c, t) => sdkAbs(t(c.value)),
  ceil: (c, t) => sdkCeil(t(c.value)),
  floor: (c, t) => sdkFloor(t(c.value)),
  round: (c, t) =>
    c.decimalPlaces === undefined ? sdkRound(t(c.value)) : sdkRound(t(c.value), t(c.decimalPlaces)),
  trunc: (c, t) =>
    c.decimalPlaces === undefined ? sdkTrunc(t(c.value)) : sdkTrunc(t(c.value), t(c.decimalPlaces)),
  sqrt: (c, t) => sdkSqrt(t(c.value)),
  exp: (c, t) => sdkExp(t(c.value)),
  ln: (c, t) => sdkLn(t(c.value)),
  log10: (c, t) => sdkLog10(t(c.value)),
  // string
  charLength: (c, t) => sdkCharLength(t(c.value)),
  byteLength: (c, t) => sdkByteLength(t(c.value)),
  toLower: (c, t) => sdkToLower(t(c.value)),
  toUpper: (c, t) => sdkToUpper(t(c.value)),
  stringReverse: (c, t) => sdkStringReverse(t(c.value)),
  trim: (c, t) =>
    c.characters === undefined ? sdkTrim(t(c.value)) : sdkTrim(t(c.value), t(c.characters)),
  ltrim: (c, t) =>
    c.characters === undefined ? sdkLtrim(t(c.value)) : sdkLtrim(t(c.value), t(c.characters)),
  rtrim: (c, t) =>
    c.characters === undefined ? sdkRtrim(t(c.value)) : sdkRtrim(t(c.value), t(c.characters)),
  startsWith: (c, t) => sdkStartsWith(t(c.value), t(c.prefix)),
  endsWith: (c, t) => sdkEndsWith(t(c.value), t(c.suffix)),
  stringContains: (c, t) => sdkStringContains(t(c.value), t(c.substring)),
  stringConcat: (c, t) => {
    const [f, s, ...r] = c.operands;
    return sdkStringConcat(t(f), t(s), ...r.map(t));
  },
  stringIndexOf: (c, t) => sdkStringIndexOf(t(c.value), t(c.substring)),
  stringRepeat: (c, t) => sdkStringRepeat(t(c.value), t(c.count)),
  stringReplaceAll: (c, t) => sdkStringReplaceAll(t(c.value), t(c.find), t(c.replacement)),
  stringReplaceOne: (c, t) => sdkStringReplaceOne(t(c.value), t(c.find), t(c.replacement)),
  substring: (c, t) =>
    c.length === undefined
      ? sdkSubstring(t(c.value), t(c.position))
      : sdkSubstring(t(c.value), t(c.position), t(c.length)),
  like: (c, t) => sdkLike(t(c.value), t(c.pattern)),
  // regex
  regexContains: (c, t) => sdkRegexContains(t(c.value), t(c.pattern)),
  regexMatch: (c, t) => sdkRegexMatch(t(c.value), t(c.pattern)),
  regexFind: (c, t) => sdkRegexFind(t(c.value), t(c.pattern)),
  regexFindAll: (c, t) => sdkRegexFindAll(t(c.value), t(c.pattern)),
  // reference
  documentId: (c, t) => sdkDocumentId(t(c.reference)),
  collectionId: (c, t) => sdkCollectionId(t(c.reference)),
  // type
  type: (c, t) => sdkType(t(c.value)),
  // The SDK's isType type name is a plain string — pass the literal payload field.
  isType: (c, t) => sdkIsType(t(c.value), c.typeName),
  // existence & error
  exists: (c, t) => sdkExists(t(c.target)),
  isAbsent: (c, t) => sdkIsAbsent(t(c.target)),
  isError: (c, t) => sdkIsError(t(c.value)),
  ifError: (c, t) => sdkIfError(t(c.tryExpr), t(c.catchExpr)),
  ifAbsent: (c, t) => sdkIfAbsent(t(c.value), t(c.fallback)),
  ifNull: (c, t) => sdkIfNull(t(c.value), t(c.fallback)),
  // array
  arrayValue: (c, t) => sdkArray(c.elements.map(t)),
  arrayLength: (c, t) => sdkArrayLength(t(c.value)),
  // arrayReverse exists at runtime but the SDK's typings only declare the fluent form.
  arrayReverse: (c, t) => t(c.value).arrayReverse(),
  arrayGet: (c, t) => sdkArrayGet(t(c.value), t(c.index)),
  arrayContains: (c, t) => sdkArrayContains(t(c.value), t(c.element)),
  arrayContainsAll: (c, t) => sdkArrayContainsAll(t(c.value), t(c.options)),
  arrayContainsAny: (c, t) => sdkArrayContainsAny(t(c.value), t(c.options)),
  arrayConcat: (c, t) => {
    const [f, s, ...r] = c.operands;
    return sdkArrayConcat(t(f), t(s), ...r.map(t));
  },
  // map
  mapValue: (c, t) =>
    sdkMap(Object.fromEntries(Object.entries(c.fields).map(([k, e]) => [k, t(e)]))),
  // The SDK's map key parameters are plain strings — pass the literal payload fields.
  mapGet: (c, t) => sdkMapGet(t(c.value), c.key),
  mapKeys: (c, t) => sdkMapKeys(t(c.value)),
  mapValues: (c, t) => sdkMapValues(t(c.value)),
  mapEntries: (c, t) => sdkMapEntries(t(c.value)),
  mapSet: (c, t) => sdkMapSet(t(c.value), c.key, t(c.entry)),
  mapRemove: (c, t) => sdkMapRemove(t(c.value), c.key),
  mapMerge: (c, t) => {
    const [f, s, ...r] = c.operands;
    return sdkMapMerge(t(f), t(s), ...r.map(t));
  },
  // timestamp
  currentTimestamp: () => sdkCurrentTimestamp(),
  timestampToUnixSeconds: (c, t) => sdkTimestampToUnixSeconds(t(c.value)),
  timestampToUnixMillis: (c, t) => sdkTimestampToUnixMillis(t(c.value)),
  timestampToUnixMicros: (c, t) => sdkTimestampToUnixMicros(t(c.value)),
  unixSecondsToTimestamp: (c, t) => sdkUnixSecondsToTimestamp(t(c.value)),
  unixMillisToTimestamp: (c, t) => sdkUnixMillisToTimestamp(t(c.value)),
  unixMicrosToTimestamp: (c, t) => sdkUnixMicrosToTimestamp(t(c.value)),
  // The literal `unit` has no (Expression, literal-unit, Expression-amount)
  // overload — take the all-Expression form, lifting the unit to a constant
  // (the same wire form the backend validates — probed).
  timestampAdd: (c, t) => sdkTimestampAdd(t(c.value), sdkConstant(c.unit), t(c.amount)),
  timestampSubtract: (c, t) => sdkTimestampSubtract(t(c.value), sdkConstant(c.unit), t(c.amount)),
  timestampDiff: (c, t) => sdkTimestampDiff(t(c.end), t(c.start), c.unit),
  // granularity / part / timezone are plain literals — the SDK's TimeGranularity
  // / TimePart overloads take them directly (probed to be the literal form the
  // backend validates).
  timestampTruncate: (c, t) =>
    c.timezone === undefined
      ? sdkTimestampTruncate(t(c.value), c.granularity)
      : sdkTimestampTruncate(t(c.value), c.granularity, c.timezone),
  timestampExtract: (c, t) =>
    c.timezone === undefined
      ? sdkTimestampExtract(t(c.value), c.part)
      : sdkTimestampExtract(t(c.value), c.part, c.timezone),
  // vector
  cosineDistance: (c, t) => sdkCosineDistance(t(c.left), t(c.right)),
  dotProduct: (c, t) => sdkDotProduct(t(c.left), t(c.right)),
  euclideanDistance: (c, t) => sdkEuclideanDistance(t(c.left), t(c.right)),
  vectorLength: (c, t) => sdkVectorLength(t(c.vector)),
};

/**
 * Dispatches an accumulator payload to its {@link aggregateTranslators} entry —
 * the aggregate counterpart of {@link dispatch}. The generic `K` ties the
 * payload's `name` to the matching translator entry (the same single-type-
 * variable trick that avoids a whole-union assertion).
 */
const dispatchAggregate = <K extends AggregateFunctionName>(
  call: Extract<AggregatePayload, { name: K }>,
  t: (e: Expression) => SdkExpression,
): SdkAggregateFunction => aggregateTranslators[call.name](call, t);

/**
 * One translator per accumulator name — a mapped type over the name union
 * requires every key, so a newly added accumulator fails to compile until
 * translated (mirrors {@link functionTranslators}). Every accumulator has a
 * standalone SDK factory taking an `Expression`; `countIf` takes a
 * `BooleanExpression`, so its operand is wrapped with `asBoolean()` (a type-tag
 * only, no wire change).
 */
type AggregateTranslators = {
  [K in AggregateFunctionName]: (
    call: Extract<AggregatePayload, { name: K }>,
    t: (e: Expression) => SdkExpression,
  ) => SdkAggregateFunction;
};

const aggregateTranslators: AggregateTranslators = {
  countAll: () => sdkCountAll(),
  count: (c, t) => sdkCount(t(c.value)),
  countDistinct: (c, t) => sdkCountDistinct(t(c.value)),
  countIf: (c, t) => sdkCountIf(t(c.condition).asBoolean()),
  sum: (c, t) => sdkSum(t(c.value)),
  average: (c, t) => sdkAverage(t(c.value)),
  minimum: (c, t) => sdkMinimum(t(c.value)),
  maximum: (c, t) => sdkMaximum(t(c.value)),
  first: (c, t) => sdkFirst(t(c.value)),
  last: (c, t) => sdkLast(t(c.value)),
  arrayAgg: (c, t) => sdkArrayAgg(t(c.value)),
  arrayAggDistinct: (c, t) => sdkArrayAggDistinct(t(c.value)),
};

const toSdkOrdering = (ordering: Ordering) => {
  const { expression } = ordering;
  switch (expression.kind) {
    case 'field':
      break;
    case 'constant':
    case 'functionCall':
      throw new Error('firebase pipeline executor: only field orderings are supported in sort yet');
    default:
      return assertNever(expression);
  }
  const f = field(expression.path);
  switch (ordering.direction) {
    case 'ascending':
      return f.ascending();
    case 'descending':
      return f.descending();
    default:
      return assertNever(ordering.direction);
  }
};
