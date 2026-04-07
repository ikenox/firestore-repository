import { DocRef, ParentDocRef } from './repository.js';
import type { Collection } from './schema.js';

/**
 * Returns the fully-qualified path of a document
 */
export const documentPath = <T extends Collection>(collection: T, docRef: DocRef<T>): string => {
  let path = '';

  // parent document path
  for (let i = 0; i < collection.parent.length; i++) {
    path += `${collection.parent[i]}/${docRef[i]}/`;
  }

  path += `${collection.name}/${docRef.at(-1)}`;
  return path;
};

/**
 * Returns the fully-qualified path of a collection
 */
export const collectionPath = <T extends Collection>(
  collection: T,
  parentDocRef: ParentDocRef<T>,
): string => {
  let path = '';

  // parent document path
  for (let i = 0; i < collection.parent.length; i++) {
    path += `${collection.parent[i]}/${parentDocRef[i]}/`;
  }

  path += collection.name;
  return path;
};
