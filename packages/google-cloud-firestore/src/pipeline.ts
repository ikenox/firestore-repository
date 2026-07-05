import { type Firestore, Pipelines } from '@google-cloud/firestore';
import type { Ordering } from 'firestore-repository/pipelines/ordering';
import type {
  Pipeline,
  PipelineNode,
  PipelineQueryExecutor,
  PipelineResult,
  PipelineRowIdentity,
} from 'firestore-repository/pipelines/pipeline';
import type { Stage } from 'firestore-repository/pipelines/stage';
import type { DocumentSchema } from 'firestore-repository/schema';

import { buildFirestoreUtilities } from './index.js';

/**
 * Builds a {@link PipelineQueryExecutor} backed by the `@google-cloud/firestore`
 * admin SDK (Enterprise edition). It walks the repository's `Pipeline` AST into
 * `db.pipeline()...` and runs it via the pipeline's `execute()`.
 *
 * Implemented so far: a bare collection input plus `sort`. Other sources /
 * stages throw.
 */
export const executor = (db: Firestore): PipelineQueryExecutor => {
  const execute = async <Schema extends DocumentSchema, Id extends PipelineRowIdentity>(
    pipeline: Pipeline<Schema, Id>,
  ): Promise<PipelineResult<Schema, Id>[]> => {
    // Collect the stage chain from the input (root) to this leaf.
    const stages: Stage[] = [];
    for (let node: PipelineNode | undefined = pipeline; node !== undefined; node = node.parent) {
      stages.unshift(node.stage);
    }

    const input = stages[0];
    if (input === undefined || input.kind !== 'input') {
      throw new Error('google-cloud pipeline executor: pipeline must start with an input stage');
    }
    if (input.source.kind !== 'collection') {
      throw new Error(
        `google-cloud pipeline executor: input source "${input.source.kind}" not supported yet`,
      );
    }
    const { collection } = input.source;
    if (collection.parent.length > 0) {
      throw new Error('google-cloud pipeline executor: only root collections are supported yet');
    }

    let sdk = db.pipeline().collection(collection.name);
    for (const stage of stages.slice(1)) {
      sdk = applyStage(sdk, stage);
    }

    const { fromFirestore } = buildFirestoreUtilities(db, collection);
    const snapshot = await sdk.execute();
    return snapshot.results.map((r) => {
      const data = fromFirestore.decode(r.data());
      const id = r.ref ? fromFirestore.docRef(r.ref) : undefined;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `data`/`id` are runtime values matching the caller's Schema/Id, which the compiler cannot prove here
      return (id === undefined ? { data } : { data, id }) as PipelineResult<Schema, Id>;
    });
  };
  return { execute };
};

const applyStage = (sdk: Pipelines.Pipeline, stage: Stage): Pipelines.Pipeline => {
  switch (stage.kind) {
    case 'sort': {
      const [first, ...rest] = stage.orderings.map(toSdkOrdering);
      return first === undefined ? sdk : sdk.sort(first, ...rest);
    }
    default:
      throw new Error(`google-cloud pipeline executor: stage "${stage.kind}" not supported yet`);
  }
};

const toSdkOrdering = (ordering: Ordering) => {
  if (ordering.expression.kind !== 'field') {
    throw new Error(
      'google-cloud pipeline executor: only field orderings are supported in sort yet',
    );
  }
  const f = Pipelines.field(ordering.expression.path);
  return ordering.direction === 'ascending' ? f.ascending() : f.descending();
};
