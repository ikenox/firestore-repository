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
  mod as sdkMod,
  multiply as sdkMultiply,
  not as sdkNot,
  notEqual as sdkNotEqual,
  or as sdkOr,
  pow as sdkPow,
  rand as sdkRand,
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
  type Expression as SdkExpression,
  type Pipeline as SdkPipeline,
  type Selectable as SdkSelectable,
} from '@firebase/firestore/pipelines';
import { collectionPath, documentPath } from 'firestore-repository/path';
import {
  type BinaryFunctionName,
  type Constant,
  type ConstantArray,
  type Expression,
  DocRefValue,
  GeoPointValue,
  VectorValue,
  ExpressionWithAlias,
  type BinaryFunction,
  type NullaryFunctionName,
  type TernaryFunctionName,
  UnaryFunctionName,
  VariadicFunctionName,
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
    case 'where':
      // `asBoolean()` is a type-tag wrap for the SDK's `BooleanExpression`
      // parameter — it does not change the wire proto.
      return sdk.where(toSdkExpression(db, stage.condition).asBoolean());
    case 'limit':
      return sdk.limit(stage.limit);
    case 'offset':
      return sdk.offset(stage.offset);
    case 'unnest':
    case 'aggregate':
    case 'distinct':
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
    case 'geoPointValue':
    case 'vectorValue':
    case 'docRefValue':
      // Value nodes also appear as constant-composite leaves; toSdkConstant
      // is the single home for their translation.
      return toSdkConstant(db, expression);
    case 'nullaryFunction':
      return nullaryFns[expression.name]();
    case 'unaryFunction':
      return unaryFns[expression.name](toSdkExpression(db, expression.operand));
    case 'binaryFunction':
      return binaryFns[expression.name](
        toSdkExpression(db, expression.left),
        toSdkExpression(db, expression.right),
        expression,
      );
    case 'ternaryFunction':
      return ternaryFns[expression.name](
        toSdkExpression(db, expression.first),
        toSdkExpression(db, expression.second),
        toSdkExpression(db, expression.third),
      );
    case 'variadicFunction': {
      const [first, second, ...rest] = expression.operands;
      return variadicFns[expression.name](
        toSdkExpression(db, first),
        toSdkExpression(db, second),
        ...rest.map((operand) => toSdkExpression(db, operand)),
      );
    }
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
    return sdkConstant(doc(db, documentPath(value.collection, value.id)));
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

// Per-shape translation tables: `Record` over the name union requires every
// key, so a newly added function name fails to compile here until translated.
// (`asBoolean()` wraps satisfy the SDK's `BooleanExpression` parameters — a
// type-tag only, no wire change.)

const nullaryFns: Record<NullaryFunctionName, () => SdkExpression> = { rand: sdkRand };

const unaryFns: Record<UnaryFunctionName, (o: SdkExpression) => SdkExpression> = {
  not: (o) => sdkNot(o.asBoolean()),
  abs: sdkAbs,
  ceil: sdkCeil,
  floor: sdkFloor,
  round: sdkRound,
  trunc: sdkTrunc,
  sqrt: sdkSqrt,
  exp: sdkExp,
  ln: sdkLn,
  log10: sdkLog10,
  charLength: sdkCharLength,
  byteLength: sdkByteLength,
  toLower: sdkToLower,
  toUpper: sdkToUpper,
  stringReverse: sdkStringReverse,
  trim: sdkTrim,
  ltrim: sdkLtrim,
  rtrim: sdkRtrim,
  documentId: sdkDocumentId,
  collectionId: sdkCollectionId,
  type: sdkType,
  vectorLength: sdkVectorLength,
};

// Entries receive the raw AST node too: functions with backend-mandated
// LITERAL arguments (isType's type name) must hand the SDK helper the plain
// string, which is unrecoverable from the translated constant expression.
const binaryFns: Record<
  BinaryFunctionName,
  (l: SdkExpression, r: SdkExpression, node: BinaryFunction) => SdkExpression
> = {
  equal: sdkEqual,
  notEqual: sdkNotEqual,
  lessThan: sdkLessThan,
  lessThanOrEqual: sdkLessThanOrEqual,
  greaterThan: sdkGreaterThan,
  greaterThanOrEqual: sdkGreaterThanOrEqual,
  add: sdkAdd,
  subtract: sdkSubtract,
  multiply: sdkMultiply,
  divide: sdkDivide,
  mod: sdkMod,
  pow: sdkPow,
  round: sdkRound,
  trunc: sdkTrunc,
  trim: sdkTrim,
  ltrim: sdkLtrim,
  rtrim: sdkRtrim,
  startsWith: sdkStartsWith,
  endsWith: sdkEndsWith,
  stringContains: sdkStringContains,
  stringIndexOf: sdkStringIndexOf,
  stringRepeat: sdkStringRepeat,
  substring: (l, r) => sdkSubstring(l, r),
  like: sdkLike,
  regexContains: sdkRegexContains,
  regexMatch: sdkRegexMatch,
  regexFind: sdkRegexFind,
  regexFindAll: sdkRegexFindAll,
  isType: (l, _r, node) => sdkIsType(l, literalStringOperand(node.right)),
  cosineDistance: sdkCosineDistance,
  dotProduct: sdkDotProduct,
  euclideanDistance: sdkEuclideanDistance,
};

const ternaryFns: Record<
  TernaryFunctionName,
  (a: SdkExpression, b: SdkExpression, c: SdkExpression) => SdkExpression
> = {
  stringReplaceAll: sdkStringReplaceAll,
  stringReplaceOne: sdkStringReplaceOne,
  substring: sdkSubstring,
};

/**
 * Recovers the literal string a factory lifted into a constant operand
 * (e.g. `isType`'s type name): the backend requires the wire argument to be
 * a constant, and the SDK helper takes it as a plain string.
 */
const literalStringOperand = (operand: Expression): string => {
  switch (operand.kind) {
    case 'constant': {
      const { value } = operand;
      if (typeof value === 'string') {
        return value;
      }
      throw new Error('expected a literal string constant operand');
    }
    case 'field':
    case 'geoPointValue':
    case 'vectorValue':
    case 'docRefValue':
    case 'nullaryFunction':
    case 'unaryFunction':
    case 'binaryFunction':
    case 'ternaryFunction':
    case 'variadicFunction':
      throw new Error(`expected a constant operand, got ${operand.kind}`);
    default:
      return assertNever(operand);
  }
};

const variadicFns: Record<
  VariadicFunctionName,
  (first: SdkExpression, second: SdkExpression, ...rest: SdkExpression[]) => SdkExpression
> = {
  and: (f, s, ...r) => sdkAnd(f.asBoolean(), s.asBoolean(), ...r.map((e) => e.asBoolean())),
  or: (f, s, ...r) => sdkOr(f.asBoolean(), s.asBoolean(), ...r.map((e) => e.asBoolean())),
  stringConcat: sdkStringConcat,
};

const toSdkOrdering = (ordering: Ordering) => {
  const { expression } = ordering;
  switch (expression.kind) {
    case 'field':
      break;
    case 'constant':
    case 'geoPointValue':
    case 'vectorValue':
    case 'docRefValue':
    case 'nullaryFunction':
    case 'unaryFunction':
    case 'binaryFunction':
    case 'ternaryFunction':
    case 'variadicFunction':
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
