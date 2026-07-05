import type { Collection } from '../schema.js';
import type { Ordering } from './ordering.js';

export type Stage =
  | { kind: 'input'; source: InputSource }
  | { kind: 'where' }
  | { kind: 'select' }
  | { kind: 'addFields' }
  | { kind: 'removeFields' }
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
  | { kind: 'sample' }
  | { kind: 'update' }
  | { kind: 'delete' };

/** The data source of a pipeline — the payload of the `input` stage. */
export type InputSource =
  | { kind: 'collection'; collection: Collection }
  | { kind: 'collectionGroup'; collection: Collection }
  | { kind: 'database' }
  // TODO: carry the document refs / literal rows once those sources are implemented.
  | { kind: 'documents' }
  | { kind: 'literals' };
