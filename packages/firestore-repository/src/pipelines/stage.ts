import type { Collection } from '../schema.js';
import type { AggregateWithAlias, Expression, ExpressionWithAlias, Valued } from './expression.js';
import type { Ordering } from './ordering.js';
import type { SelectionNode } from './selection.js';

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
  | { kind: 'where'; condition: Expression<Valued<'boolean'>> }
  // `selections` is already conflict-resolved (last-wins applied by
  // `Pipeline.select`), so an executor can translate it 1:1.
  | { kind: 'select'; selections: readonly SelectionNode[] }
  // `selections` is already conflict-resolved (last-wins applied by
  // `Pipeline.addFields`), so an executor can translate it 1:1. Aliased
  // expressions only — see `BuildAddFieldsSchema`.
  | { kind: 'addFields'; selections: readonly ExpressionWithAlias[] }
  | { kind: 'removeFields'; fields: readonly string[] }
  | { kind: 'sort'; orderings: Ordering[] }
  | { kind: 'limit'; limit: number }
  | { kind: 'offset'; offset: number }
  // Emits one row per element of the array `selectable` evaluates to, adding the
  // element under the selectable's output name and (when set) its offset under
  // `indexField`. `selectable` is already the context-free {@link SelectionNode}
  // (its output name top-level, guarded by `Pipeline.unnest`), so an executor
  // translates it 1:1 like a `select` selection.
  | { kind: 'unnest'; selectable: SelectionNode; indexField?: string }
  // `accumulators` are the aliased accumulator calls; `groups` are the group
  // keys post-conflict-resolution (last-wins applied by `Pipeline.aggregate`,
  // mirroring `select`), so an executor translates both 1:1. Empty `groups`
  // means the whole-input group (one row; empty input yields exactly one row —
  // probed).
  | {
      kind: 'aggregate';
      accumulators: readonly AggregateWithAlias[];
      groups: readonly SelectionNode[];
    }
  // `distinct` is a grouped aggregate with ZERO accumulators, so it shares the
  // group model: `groups` are the group keys post-conflict-resolution (last-wins
  // applied by `Pipeline.distinct`, mirroring `aggregate`), and an executor
  // translates them 1:1. Always nonempty (a distinct with no keys is meaningless).
  | { kind: 'distinct'; groups: readonly SelectionNode[] }
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
