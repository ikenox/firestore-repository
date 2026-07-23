import type { DocRef, ParentDocRef } from '../repository.js';
import type { Collection } from '../schema.js';
import { Pipeline } from './pipeline.js';

// Input stage factories. Document-backed inputs start identity-preserving (the
// result rows carry a source document ref); `literals(...)` has no source
// documents so it starts unidentified. The input stage is the head of the chain,
// so an executor can reconstruct it (e.g. `db.pipeline().collection(path)`).

/**
 * The trailing `parent` argument of a collection-input factory: required for a
 * subcollection (the parent document ids locating the instance), optional for a
 * root collection (whose only valid value is the empty tuple `[]` — accepted so
 * generic code can pass a `ParentDocRef` through uniformly). Mirrors
 * `QueryBaseInput`'s root/subcollection split.
 */
type ParentArg<T extends Collection> = T['parent']['length'] extends 0
  ? [parent?: ParentDocRef<T>]
  : [parent: ParentDocRef<T>];

/**
 * Starts a pipeline that reads a single collection instance — the pipeline
 * counterpart of the SDK's `db.pipeline().collection(path)` input stage. The
 * resulting pipeline is identity-preserving: each result row carries a
 * `DocRef<T>` of its source document.
 *
 * The trailing `parent` argument adapts to the collection definition
 * (see {@link ParentArg}):
 * - **Root collection** (`def.parent` is `[]`): omitted, or the empty tuple —
 *   `collection(authorsCollection)` / `collection(authorsCollection, [])`.
 * - **Subcollection**: the parent document ids locating the instance are
 *   required, with their tuple length checked against `def.parent` —
 *   `collection(postsCollection, ['author1'])` reads `/Authors/author1/Posts`.
 *
 * To read all instances of a subcollection across the database regardless of
 * parent, use {@link collectionGroup} instead.
 */
export const collection = <T extends Collection>(
  def: T,
  ...[parent]: ParentArg<T>
): Pipeline<T['schema'], DocRef<T>> =>
  new Pipeline<T['schema'], DocRef<T>>({
    schema: def.schema,
    stage: { kind: 'collection', collection: def, parent: parent ?? [] },
  });
// Assumes collection names are unique across the database, so the group resolves
// to a single collection's schema and ref type.
export const collectionGroup = <T extends Collection>(def: T): Pipeline<T['schema'], DocRef<T>> =>
  new Pipeline<T['schema'], DocRef<T>>({
    schema: def.schema,
    stage: { kind: 'collectionGroup', collection: def },
  });

// TODO: implement the remaining input stages (`database`, `documents`,
// `literals`). Their `InputStage` kinds already exist in stage.ts, but the
// factories need a real argument/schema design (the earlier stubs took
// `unknown[]` and an empty schema, so they were removed).
