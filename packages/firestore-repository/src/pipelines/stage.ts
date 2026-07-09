import type { Collection } from '../schema.js';
import type { ExpressionWithAlias } from './expression.js';
import type { Ordering } from './ordering.js';

/**
 * A pipeline stage. Firestore's official taxonomy groups every stage into one of
 * three kinds — {@link InputStage} (the data source that begins a pipeline),
 * {@link TransformStage} (row transformations), and {@link OutputStage} (DML
 * writes) — and a pipeline is an input stage followed by zero or more transform
 * stages and an optional output stage. Mirrors the SDK, where a `Pipeline` holds
 * a flat list of stages and the source is simply the first one.
 */
export type Stage = InputStage | TransformStage | OutputStage;

/** Input stage: the data source that begins a pipeline (the chain head). */
export type InputStage =
  /**
   * A single collection instance. `parent` locates it when it is a
   * subcollection (the parent document ids, pairing with
   * `collection.parent`) — empty for a root collection. Executors resolve the
   * full path via `collectionPath(collection, parent)`; there is no separate
   * "subcollection" input stage kind (the official `subcollection` stage is
   * sub-pipeline-only syntactic sugar and cannot start an executable pipeline).
   */
  | { kind: 'collection'; collection: Collection; parent: string[] }
  | { kind: 'collectionGroup'; collection: Collection }
  | { kind: 'database' }
  // TODO: carry the document refs / literal rows once those sources are implemented.
  | { kind: 'documents' }
  | { kind: 'literals' };

/** Transformation stage: reshapes the rows flowing through the pipeline. */
export type TransformStage =
  | { kind: 'where' }
  // `selections` is already conflict-resolved (last-wins applied by
  // `Pipeline.select`), so an executor can translate it 1:1.
  | { kind: 'select'; selections: readonly (string | ExpressionWithAlias)[] }
  | { kind: 'addFields' }
  | { kind: 'removeFields'; fields: readonly string[] }
  | { kind: 'sort'; orderings: Ordering[] }
  | { kind: 'limit' }
  | { kind: 'offset' }
  | { kind: 'unnest' }
  | { kind: 'aggregate' }
  | { kind: 'distinct' }
  | { kind: 'replaceWith' }
  | { kind: 'union' }
  | { kind: 'findNearest' }
  | { kind: 'let' }
  | { kind: 'search' }
  | { kind: 'sample' };

/**
 * Output stage: Pipeline DML. Appending one turns the pipeline into a write.
 *
 * TODO: not yet wired into the node model or the `Pipeline` builder — kept here
 * so the taxonomy is complete and the `kind`s have a home.
 */
export type OutputStage = { kind: 'update' } | { kind: 'delete' };
