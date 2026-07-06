import type { DocRef } from '../repository.js';
import type { Collection } from '../schema.js';
import { Pipeline } from './pipeline.js';

// Input source factories. Document-backed sources start identity-preserving
// (the result rows carry a source document ref); `literals(...)` has no source
// documents so it starts unidentified. The `input` stage carries the source so
// an executor can reconstruct it (e.g. `db.pipeline().collection(path)`).

export const pipelineQuery = <T extends Collection>(
  collection: T,
): Pipeline<T['schema'], DocRef<T>> =>
  new Pipeline<T['schema'], DocRef<T>>(collection.schema, {
    kind: 'input',
    source: { kind: 'collection', collection },
  });

export const collection = <T extends Collection>(def: T): Pipeline<T['schema'], DocRef<T>> =>
  new Pipeline<T['schema'], DocRef<T>>(def.schema, {
    kind: 'input',
    source: { kind: 'collection', collection: def },
  });
export const subcollection = <T extends Collection>(def: T): Pipeline<T['schema'], DocRef<T>> =>
  new Pipeline<T['schema'], DocRef<T>>(def.schema, {
    kind: 'input',
    source: { kind: 'collection', collection: def },
  });
// Assumes collection names are unique across the database, so the group resolves
// to a single collection's schema and ref type.
export const collectionGroup = <T extends Collection>(def: T): Pipeline<T['schema'], DocRef<T>> =>
  new Pipeline<T['schema'], DocRef<T>>(def.schema, {
    kind: 'input',
    source: { kind: 'collectionGroup', collection: def },
  });

// TODO: implement the remaining input sources (`database`, `documents`,
// `literals`). Their `InputSource` AST kinds already exist in stage.ts, but the
// factories need a real argument/schema design (the earlier stubs took
// `unknown[]` and an empty schema, so they were removed).
