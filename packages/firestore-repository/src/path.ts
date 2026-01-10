import type { Collection, DocRef } from './schema.js';

/**
 * Returns a fully-qualified path of the document
 */
export const documentPath = <T extends Collection>(collection: T, doc: DocRef<T>): string => {
  return `${collectionPath(collection, doc.parent)}/${doc.id}`;
};

/**
 * Returns a fully-qualified path of the collection
 */
export const collectionPath = <T extends Collection>(
  collection: T,
  parentDoc: DocRef<T['parent']> | undefined,
): string => {
  return parentDoc
    ? `${documentPath(collection.parent, parentDoc)}/${collection.name}`
    : collection.name;
};
