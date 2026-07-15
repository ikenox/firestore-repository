import { FieldValue, type Firestore, GeoPoint, Pipelines } from '@google-cloud/firestore';
import { collectionPath } from 'firestore-repository/path';
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
 * Builds a {@link PipelineQueryExecutor} backed by the `@google-cloud/firestore`
 * admin SDK (Enterprise edition). It walks the repository's `Pipeline` AST into
 * `db.pipeline()...` and runs it via the pipeline's `execute()`.
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
    let sdk: Pipelines.Pipeline;
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
          `google-cloud pipeline executor: input stage "${input.kind}" not supported yet`,
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
    const snapshot = await sdk.execute();
    return snapshot.results.map((r) => {
      const data = decodeRow.parse(r.data());
      const id = r.ref ? fromFirestore.docRef(r.ref) : undefined;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `data`/`id` are runtime values matching the caller's Schema/Id, which the compiler cannot prove here
      return (id === undefined ? { data } : { data, id }) as PipelineResult<Schema, Id>;
    });
  };
  return { execute };
};

const applyStage = (
  db: Firestore,
  sdk: Pipelines.Pipeline,
  stage: TransformStage,
): Pipelines.Pipeline => {
  switch (stage.kind) {
    case 'sort': {
      const [first, ...rest] = stage.orderings.map(toSdkOrdering);
      return first === undefined ? sdk : sdk.sort(first, ...rest);
    }
    case 'select': {
      const [first, ...rest] = stage.selections.map((selection) => toSdkSelectable(db, selection));
      if (first === undefined) {
        throw new Error('google-cloud pipeline executor: select requires at least one selection');
      }
      return sdk.select(first, ...rest);
    }
    case 'removeFields': {
      const [first, ...rest] = stage.fields;
      if (first === undefined) {
        throw new Error('google-cloud pipeline executor: removeFields requires at least one field');
      }
      return sdk.removeFields(first, ...rest);
    }
    case 'addFields': {
      const [first, ...rest] = stage.selections.map((selection) => toSdkSelectable(db, selection));
      if (first === undefined) {
        throw new Error('google-cloud pipeline executor: addFields requires at least one field');
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
      throw new Error(`google-cloud pipeline executor: stage "${stage.kind}" not supported yet`);
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
const toSdkSelectable = (db: Firestore, s: string | ExpressionWithAlias): Pipelines.Selectable =>
  typeof s === 'string' ? Pipelines.field(s) : toSdkExpression(db, s.expression).as(s.alias);

/**
 * Translates the repository expression AST into an SDK expression. Threads
 * `db` for the one value kind whose SDK form needs it: a document-reference
 * constant is built via `db.doc(...)` (the codec's `buildEncodeField`
 * precedent).
 */
const toSdkExpression = (db: Firestore, expression: Expression): Pipelines.Expression => {
  switch (expression.kind) {
    case 'field':
      return Pipelines.field(expression.path);
    case 'constant':
      return toSdkConstant(db, expression.value);
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
 * nested expressions). `Constant` payload shapes are unambiguous: geopoints
 * and vectors are dedicated nodes, so an array is always an array constant
 * and a plain object always a map constant.
 */
const toSdkConstant = (db: Firestore, value: Constant['value']): Pipelines.Expression => {
  if (value === null) {
    return Pipelines.constant(null);
  }
  if (value instanceof Date) {
    return Pipelines.constant(value);
  }
  if (value instanceof Uint8Array) {
    return Pipelines.constant(value);
  }
  if (value instanceof GeoPointValue) {
    return Pipelines.constant(new GeoPoint(value.latitude, value.longitude));
  }
  if (value instanceof VectorValue) {
    return Pipelines.constant(FieldValue.vector([...value.values]));
  }
  if (value instanceof DocRefValue) {
    return Pipelines.constant(db.doc(value.path.join('/')));
  }
  if (isConstantArrayValue(value)) {
    return Pipelines.array(value.map((element) => toSdkConstant(db, element)));
  }
  switch (typeof value) {
    case 'string':
      return Pipelines.constant(value);
    case 'number':
      return Pipelines.constant(value);
    case 'boolean':
      return Pipelines.constant(value);
    case 'object':
      return Pipelines.map(
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

// Per-shape translation tables: `Record` over the name union requires every
// key, so a newly added function name fails to compile here until translated.
// (`asBoolean()` wraps satisfy the SDK's `BooleanExpression` parameters — a
// type-tag only, no wire change.)

const nullaryFns: Record<NullaryFunctionName, () => Pipelines.Expression> = {
  rand: Pipelines.rand,
  currentTimestamp: Pipelines.currentTimestamp,
};

const unaryFns: Record<UnaryFunctionName, (o: Pipelines.Expression) => Pipelines.Expression> = {
  not: (o) => Pipelines.not(o.asBoolean()),
  abs: Pipelines.abs,
  ceil: Pipelines.ceil,
  // floor/ltrim/rtrim exist at runtime but the SDK's namespace typings only
  // declare their fluent forms — translate through those.
  floor: (o) => o.floor(),
  round: Pipelines.round,
  trunc: Pipelines.trunc,
  sqrt: Pipelines.sqrt,
  exp: Pipelines.exp,
  ln: Pipelines.ln,
  log10: Pipelines.log10,
  charLength: Pipelines.charLength,
  byteLength: Pipelines.byteLength,
  toLower: Pipelines.toLower,
  toUpper: Pipelines.toUpper,
  stringReverse: Pipelines.stringReverse,
  trim: Pipelines.trim,
  ltrim: (o) => o.ltrim(),
  rtrim: (o) => o.rtrim(),
  documentId: Pipelines.documentId,
  collectionId: Pipelines.collectionId,
  type: Pipelines.type,
  timestampToUnixSeconds: Pipelines.timestampToUnixSeconds,
  timestampToUnixMillis: Pipelines.timestampToUnixMillis,
  timestampToUnixMicros: Pipelines.timestampToUnixMicros,
  unixSecondsToTimestamp: Pipelines.unixSecondsToTimestamp,
  unixMillisToTimestamp: Pipelines.unixMillisToTimestamp,
  unixMicrosToTimestamp: Pipelines.unixMicrosToTimestamp,
  vectorLength: Pipelines.vectorLength,
};

// Entries receive the raw AST node too: functions with backend-mandated
// LITERAL arguments (isType's type name) must hand the SDK helper the plain
// string, which is unrecoverable from the translated constant expression.
const binaryFns: Record<
  BinaryFunctionName,
  (l: Pipelines.Expression, r: Pipelines.Expression, node: BinaryFunction) => Pipelines.Expression
> = {
  equal: Pipelines.equal,
  notEqual: Pipelines.notEqual,
  lessThan: Pipelines.lessThan,
  lessThanOrEqual: Pipelines.lessThanOrEqual,
  greaterThan: Pipelines.greaterThan,
  greaterThanOrEqual: Pipelines.greaterThanOrEqual,
  add: Pipelines.add,
  subtract: Pipelines.subtract,
  multiply: Pipelines.multiply,
  divide: Pipelines.divide,
  mod: Pipelines.mod,
  pow: Pipelines.pow,
  round: Pipelines.round,
  trunc: Pipelines.trunc,
  trim: Pipelines.trim,
  ltrim: (l, r) => l.ltrim(r),
  rtrim: (l, r) => l.rtrim(r),
  startsWith: Pipelines.startsWith,
  endsWith: Pipelines.endsWith,
  stringContains: Pipelines.stringContains,
  // stringIndexOf/stringRepeat (and the ternary stringReplace* below) exist
  // at runtime but the SDK's namespace typings only declare their fluent
  // forms — translate through those.
  stringIndexOf: (l, r) => l.stringIndexOf(r),
  stringRepeat: (l, r) => l.stringRepeat(r),
  substring: (l, r) => Pipelines.substring(l, r),
  like: Pipelines.like,
  regexContains: Pipelines.regexContains,
  regexMatch: Pipelines.regexMatch,
  regexFind: Pipelines.regexFind,
  regexFindAll: Pipelines.regexFindAll,
  isType: (l, _r, node) => Pipelines.isType(l, literalStringOperand(node.right)),
  // The lifted literal constants (granularity / part) translate as constant
  // expressions, which IS the literal form the backend validates — probed.
  timestampTruncate: (l, r) => Pipelines.timestampTruncate(l, r),
  timestampExtract: (l, r) => Pipelines.timestampExtract(l, r),
  cosineDistance: Pipelines.cosineDistance,
  dotProduct: Pipelines.dotProduct,
  euclideanDistance: Pipelines.euclideanDistance,
};

const ternaryFns: Record<
  TernaryFunctionName,
  (
    a: Pipelines.Expression,
    b: Pipelines.Expression,
    c: Pipelines.Expression,
  ) => Pipelines.Expression
> = {
  stringReplaceAll: (a, b, c) => a.stringReplaceAll(b, c),
  stringReplaceOne: (a, b, c) => a.stringReplaceOne(b, c),
  substring: Pipelines.substring,
  timestampAdd: Pipelines.timestampAdd,
  timestampSubtract: Pipelines.timestampSubtract,
  timestampDiff: Pipelines.timestampDiff,
  timestampTruncate: Pipelines.timestampTruncate,
  timestampExtract: Pipelines.timestampExtract,
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
  (
    first: Pipelines.Expression,
    second: Pipelines.Expression,
    ...rest: Pipelines.Expression[]
  ) => Pipelines.Expression
> = {
  and: (f, s, ...r) => Pipelines.and(f.asBoolean(), s.asBoolean(), ...r.map((e) => e.asBoolean())),
  or: (f, s, ...r) => Pipelines.or(f.asBoolean(), s.asBoolean(), ...r.map((e) => e.asBoolean())),
  stringConcat: Pipelines.stringConcat,
};

/** `Array.isArray` narrows poorly over readonly-array unions — a dedicated guard does. */
const isConstantArrayValue = (value: Constant['value']): value is ConstantArray =>
  Array.isArray(value);

const toSdkOrdering = (ordering: Ordering) => {
  const { expression } = ordering;
  switch (expression.kind) {
    case 'field':
      break;
    case 'constant':
    case 'nullaryFunction':
    case 'unaryFunction':
    case 'binaryFunction':
    case 'ternaryFunction':
    case 'variadicFunction':
      throw new Error(
        'google-cloud pipeline executor: only field orderings are supported in sort yet',
      );
    default:
      return assertNever(expression);
  }
  const f = Pipelines.field(expression.path);
  switch (ordering.direction) {
    case 'ascending':
      return f.ascending();
    case 'descending':
      return f.descending();
    default:
      return assertNever(ordering.direction);
  }
};
