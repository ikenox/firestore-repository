import { Bytes, type Firestore, GeoPoint } from '@firebase/firestore';
import {
  and as sdkAnd,
  constant as sdkConstant,
  equal as sdkEqual,
  execute as executePipeline,
  field,
  greaterThan as sdkGreaterThan,
  greaterThanOrEqual as sdkGreaterThanOrEqual,
  lessThan as sdkLessThan,
  lessThanOrEqual as sdkLessThanOrEqual,
  not as sdkNot,
  notEqual as sdkNotEqual,
  or as sdkOr,
  type Expression as SdkExpression,
  type Pipeline as SdkPipeline,
  type Selectable as SdkSelectable,
} from '@firebase/firestore/pipelines';
import { collectionPath } from 'firestore-repository/path';
import type {
  BinaryFunctionName,
  ConstantValue,
  Expression,
  ExpressionWithAlias,
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
      sdk = applyStage(sdk, stage);
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

const applyStage = (sdk: SdkPipeline, stage: TransformStage): SdkPipeline => {
  switch (stage.kind) {
    case 'sort': {
      const [first, ...rest] = stage.orderings.map(toSdkOrdering);
      return first === undefined ? sdk : sdk.sort(first, ...rest);
    }
    case 'select': {
      const [first, ...rest] = stage.selections.map(toSdkSelectable);
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
      const [first, ...rest] = stage.selections.map(toSdkSelectable);
      if (first === undefined) {
        throw new Error('firebase pipeline executor: addFields requires at least one field');
      }
      return sdk.addFields(first, ...rest);
    }
    case 'where':
      // `asBoolean()` is a type-tag wrap for the SDK's `BooleanExpression`
      // parameter — it does not change the wire proto.
      return sdk.where(toSdkExpression(stage.condition).asBoolean());
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
const toSdkSelectable = (s: string | ExpressionWithAlias): SdkSelectable =>
  typeof s === 'string' ? field(s) : toSdkExpression(s.expression).as(s.alias);

/** Translates the repository expression AST into an SDK expression. */
const toSdkExpression = (expression: Expression): SdkExpression => {
  switch (expression.kind) {
    case 'field':
      return field(expression.path);
    case 'constant':
      return toSdkConstant(expression.value);
    case 'unaryFunction':
      return unaryFns[expression.name](toSdkExpression(expression.operand));
    case 'binaryFunction':
      return binaryFns[expression.name](
        toSdkExpression(expression.left),
        toSdkExpression(expression.right),
      );
    case 'variadicFunction': {
      const [first, second, ...rest] = expression.operands;
      return variadicFns[expression.name](
        toSdkExpression(first),
        toSdkExpression(second),
        ...rest.map(toSdkExpression),
      );
    }
    default:
      return assertNever(expression);
  }
};

/**
 * Translates a constant value into an SDK constant expression, converting the
 * repository's plain value types into the SDK's classes where they differ
 * (plain `GeoPoint` object → SDK `GeoPoint`; `Uint8Array` → `Bytes`; `Date`
 * is accepted natively).
 */
const toSdkConstant = (value: ConstantValue): SdkExpression => {
  if (value === null) {
    return sdkConstant(value);
  }
  if (value instanceof Date) {
    return sdkConstant(value);
  }
  if (value instanceof Uint8Array) {
    return sdkConstant(Bytes.fromUint8Array(value));
  }
  switch (typeof value) {
    case 'string':
      return sdkConstant(value);
    case 'number':
      return sdkConstant(value);
    case 'boolean':
      return sdkConstant(value);
    case 'object':
      return sdkConstant(new GeoPoint(value.latitude, value.longitude));
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

const unaryFns: Record<UnaryFunctionName, (o: SdkExpression) => SdkExpression> = {
  not: (o) => sdkNot(o.asBoolean()),
};

const binaryFns: Record<BinaryFunctionName, (l: SdkExpression, r: SdkExpression) => SdkExpression> =
  {
    equal: sdkEqual,
    notEqual: sdkNotEqual,
    lessThan: sdkLessThan,
    lessThanOrEqual: sdkLessThanOrEqual,
    greaterThan: sdkGreaterThan,
    greaterThanOrEqual: sdkGreaterThanOrEqual,
  };

const variadicFns: Record<
  VariadicFunctionName,
  (first: SdkExpression, second: SdkExpression, ...rest: SdkExpression[]) => SdkExpression
> = {
  and: (f, s, ...r) => sdkAnd(f.asBoolean(), s.asBoolean(), ...r.map((e) => e.asBoolean())),
  or: (f, s, ...r) => sdkOr(f.asBoolean(), s.asBoolean(), ...r.map((e) => e.asBoolean())),
};

const toSdkOrdering = (ordering: Ordering) => {
  const { expression } = ordering;
  switch (expression.kind) {
    case 'field':
      break;
    case 'constant':
    case 'unaryFunction':
    case 'binaryFunction':
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
