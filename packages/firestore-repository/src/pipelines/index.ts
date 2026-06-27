import type { Collection, DocumentSchema } from '../schema.js';
import { Pipeline } from './pipeline.js';

export * from './expression.js';
export * from './pipeline.js';
export * from './selection.js';
export * from './stage.js';

type Fields = DocumentSchema;

export const pipelineQuery = <T extends Collection>(collection: T): Pipeline<T['schema']> =>
  new Pipeline(collection.schema, { kind: 'input' });

// Input source factories. Real Context/identity typing is deferred (see
// docs/plan/pipeline-query.md); these are stubs that build an `input` stage.
export const collection = <T extends Collection>(def: T): Pipeline<T['schema']> =>
  new Pipeline(def.schema, { kind: 'input' });
export const subcollection = <T extends Collection>(def: T): Pipeline<T['schema']> =>
  new Pipeline(def.schema, { kind: 'input' });
export const collectionGroup = (..._args: unknown[]): Pipeline<Fields> =>
  new Pipeline<Fields>({}, { kind: 'input' });
export const database = (..._args: unknown[]): Pipeline<Fields> =>
  new Pipeline<Fields>({}, { kind: 'input' });
export const documents = (..._args: unknown[]): Pipeline<Fields> =>
  new Pipeline<Fields>({}, { kind: 'input' });
export const literals = (..._args: unknown[]): Pipeline<Fields> =>
  new Pipeline<Fields>({}, { kind: 'input' });
