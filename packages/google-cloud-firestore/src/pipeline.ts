import { type Firestore, Pipelines } from '@google-cloud/firestore';
import { collectionPath } from 'firestore-repository/path';
import type {
  Expression,
  ExpressionWithAlias,
  FunctionCall,
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
      sdk = applyStage(sdk, stage);
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

const applyStage = (sdk: Pipelines.Pipeline, stage: TransformStage): Pipelines.Pipeline => {
  switch (stage.kind) {
    case 'sort': {
      const [first, ...rest] = stage.orderings.map(toSdkOrdering);
      return first === undefined ? sdk : sdk.sort(first, ...rest);
    }
    case 'select': {
      const [first, ...rest] = stage.selections.map(toSdkSelectable);
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
    case 'where':
    case 'addFields':
    case 'limit':
    case 'offset':
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

/** Translates a selection (bare path or aliased expression) into an SDK selectable. */
const toSdkSelectable = (s: string | ExpressionWithAlias): Pipelines.Selectable | string =>
  typeof s === 'string' ? s : toSdkExpression(s.expression).as(s.alias);

/** Translates the repository expression AST into an SDK expression. */
const toSdkExpression = (expression: Expression): Pipelines.Expression => {
  switch (expression.kind) {
    case 'field':
      return Pipelines.field(expression.path);
    case 'constant':
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `Constant.value` is untyped (TODO in expression.ts); the SDK's `constant` overloads want a concrete primitive, but the raw value passes through unchanged at runtime
      return Pipelines.constant(expression.value as string);
    case 'functionCall':
      return toSdkFunctionCall(expression);
    default:
      return assertNever(expression);
  }
};

// `FunctionCall.name` is an open string (not a union), so `default` is the
// unsupported-function guard rather than `assertNever`.
const toSdkFunctionCall = (expression: FunctionCall): Pipelines.Expression => {
  switch (expression.name) {
    case 'equal': {
      // TODO: this runtime arity guard disappears once FunctionCall is
      // restructured into shape-grouped classes with typed payload fields —
      // see "Restructure FunctionCall" in docs/plan/pipeline-query.md.
      const [left, right] = expression.args;
      if (left === undefined || right === undefined) {
        throw new Error('google-cloud pipeline executor: equal requires two arguments');
      }
      return Pipelines.equal(toSdkExpression(left), toSdkExpression(right));
    }
    default:
      throw new Error(
        `google-cloud pipeline executor: function "${expression.name}" not supported yet`,
      );
  }
};

const toSdkOrdering = (ordering: Ordering) => {
  const { expression } = ordering;
  switch (expression.kind) {
    case 'field':
      break;
    case 'constant':
    case 'functionCall':
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
