import { DocRef, ParentDocRef } from './repository.js';
import type { Collection, RefPath } from './schema.js';

/**
 * Converts an ids-only ADDRESS (`DocRef`, the repository interface's id
 * representation) into a reference VALUE (`RefPath` segment path) by
 * interleaving the collection names from the collection definition:
 * `refPath(posts, ['a1', 'p1'])` -> `['Authors', 'a1', 'Posts', 'p1']`.
 */
export const refPath = <T extends Collection>(collection: T, docRef: DocRef<T>): RefPath<T> =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- flatMap cannot preserve the interleaved tuple shape
  [...collection.parent, collection.name].flatMap((name, i) => [
    name,
    docRef[i] as string,
  ]) as RefPath<T>;

/**
 * Narrows a context-free reference value (`RefPath<'unknown'>`, a plain
 * `string[]` read from a `docRef()` field or a raw `__name__` key) into the
 * typed `RefPath` of a collection the caller knows it belongs to. The claim
 * is validated at runtime — segment count and every collection-name
 * position — since the input carries no static shape.
 */
export const parseRefPath = <T extends Collection>(collection: T, path: string[]): RefPath<T> => {
  const names = [...collection.parent, collection.name];
  if (path.length !== names.length * 2) {
    throw new Error(
      `reference path [${path.join(', ')}] does not belong to collection '${collection.name}': expected ${names.length * 2} segments`,
    );
  }
  names.forEach((name, i) => {
    if (path[i * 2] !== name) {
      throw new Error(
        `reference path [${path.join(', ')}] does not belong to collection '${collection.name}': segment ${i * 2} is '${path[i * 2]}', expected '${name}'`,
      );
    }
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the loop above verified exactly the shape RefPath<T> declares
  return path as RefPath<T>;
};

/**
 * Converts a reference VALUE (`RefPath` segment path) back into the ids-only
 * ADDRESS (`DocRef`) of the given collection, so a reference read from a
 * document field can be passed to that collection's repository. Takes the
 * typed `RefPath<T>` only — narrow a context-free `string[]` with
 * {@link parseRefPath} first. (Validation still runs, via `parseRefPath`, as a
 * guard for assertion-carrying callers.)
 */
export const toDocRef = <T extends Collection>(collection: T, path: RefPath<T>): DocRef<T> =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- filter cannot preserve the tuple shape
  parseRefPath(collection, path).filter((_, i) => i % 2 === 1) as DocRef<T>;
/**
 * Returns the fully-qualified path of a document
 */
export const documentPath = <T extends Collection>(collection: T, docRef: DocRef<T>): string =>
  refPath(collection, docRef).join('/');

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
