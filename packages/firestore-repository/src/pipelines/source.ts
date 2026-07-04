import type { DocRef } from '../repository.js';
import type { Collection, DocumentSchema } from '../schema.js';
import { Pipeline } from './pipeline.js';

type Fields = DocumentSchema;

// Input source factories. Document-backed sources start identity-preserving
// (the result rows carry a source document ref); `literals(...)` has no source
// documents so it starts unidentified. Real Context/runtime typing is deferred
// (see docs/plan/pipeline-query.md); these are stubs that build an `input` stage.

export const pipelineQuery = <T extends Collection>(
  collection: T,
): Pipeline<T['schema'], DocRef<T>> =>
  new Pipeline<T['schema'], DocRef<T>>(collection.schema, { kind: 'input' });

export const collection = <T extends Collection>(def: T): Pipeline<T['schema'], DocRef<T>> =>
  new Pipeline<T['schema'], DocRef<T>>(def.schema, { kind: 'input' });
export const subcollection = <T extends Collection>(def: T): Pipeline<T['schema'], DocRef<T>> =>
  new Pipeline<T['schema'], DocRef<T>>(def.schema, { kind: 'input' });
// Assumes collection names are unique across the database, so the group resolves
// to a single collection's schema and ref type.
export const collectionGroup = <T extends Collection>(def: T): Pipeline<T['schema'], DocRef<T>> =>
  new Pipeline<T['schema'], DocRef<T>>(def.schema, { kind: 'input' });
export const database = (..._args: unknown[]): Pipeline<Fields, DocRef<Collection>> =>
  new Pipeline<Fields, DocRef<Collection>>({}, { kind: 'input' });
export const documents = (..._args: unknown[]): Pipeline<Fields, DocRef<Collection>> =>
  new Pipeline<Fields, DocRef<Collection>>({}, { kind: 'input' });
export const literals = (..._args: unknown[]): Pipeline<Fields, undefined> =>
  new Pipeline<Fields, undefined>({}, { kind: 'input' });
