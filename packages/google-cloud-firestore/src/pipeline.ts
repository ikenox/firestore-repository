import { type Firestore, Pipelines } from '@google-cloud/firestore';
import { collectionPath } from 'firestore-repository/path';
import type {
  BinaryFunctionName,
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
    case 'addFields': {
      const [first, ...rest] = stage.selections.map(toSdkSelectable);
      if (first === undefined) {
        throw new Error('google-cloud pipeline executor: addFields requires at least one field');
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
const toSdkSelectable = (s: string | ExpressionWithAlias): Pipelines.Selectable =>
  typeof s === 'string' ? Pipelines.field(s) : toSdkExpression(s.expression).as(s.alias);

/** Translates the repository expression AST into an SDK expression. */
const toSdkExpression = (expression: Expression): Pipelines.Expression => {
  switch (expression.kind) {
    case 'field':
      return Pipelines.field(expression.path);
    case 'constant':
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `Constant.value` is untyped (TODO in expression.ts); the SDK's `constant` overloads want a concrete primitive, but the raw value passes through unchanged at runtime
      return Pipelines.constant(expression.value as string);
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

// Per-shape translation tables: `Record` over the name union requires every
// key, so a newly added function name fails to compile here until translated.
// (`asBoolean()` wraps satisfy the SDK's `BooleanExpression` parameters — a
// type-tag only, no wire change.)

const unaryFns: Record<UnaryFunctionName, (o: Pipelines.Expression) => Pipelines.Expression> = {
  not: (o) => Pipelines.not(o.asBoolean()),
};

const binaryFns: Record<
  BinaryFunctionName,
  (l: Pipelines.Expression, r: Pipelines.Expression) => Pipelines.Expression
> = {
  equal: Pipelines.equal,
  notEqual: Pipelines.notEqual,
  lessThan: Pipelines.lessThan,
  lessThanOrEqual: Pipelines.lessThanOrEqual,
  greaterThan: Pipelines.greaterThan,
  greaterThanOrEqual: Pipelines.greaterThanOrEqual,
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
