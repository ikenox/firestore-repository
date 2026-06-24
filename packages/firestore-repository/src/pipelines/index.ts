import type { Collection } from '../schema.js';
import { Pipeline } from './pipeline.js';

export * from './expression.js';
export * from './pipeline.js';
export * from './selection.js';
export * from './stage.js';

export const pipelineQuery = <T extends Collection>(
  collection: T,
): Pipeline<T['schema']> => ({}) as any;
