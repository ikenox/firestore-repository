import type { DocRef } from '../repository.js';
import type { Collection } from '../schema.js';
import { Pipeline } from './pipeline.js';

// Input stage factories. Document-backed inputs start identity-preserving (the
// result rows carry a source document ref); `literals(...)` has no source
// documents so it starts unidentified. The input stage is the head of the chain,
// so an executor can reconstruct it (e.g. `db.pipeline().collection(path)`).

export const pipelineQuery = <T extends Collection>(
  collection: T,
): Pipeline<T['schema'], DocRef<T>> =>
  new Pipeline<T['schema'], DocRef<T>>({
    schema: collection.schema,
    stage: { kind: 'collection', collection },
  });

export const collection = <T extends Collection>(def: T): Pipeline<T['schema'], DocRef<T>> =>
  new Pipeline<T['schema'], DocRef<T>>({
    schema: def.schema,
    stage: { kind: 'collection', collection: def },
  });
export const subcollection = <T extends Collection>(def: T): Pipeline<T['schema'], DocRef<T>> =>
  new Pipeline<T['schema'], DocRef<T>>({
    schema: def.schema,
    stage: { kind: 'collection', collection: def },
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
