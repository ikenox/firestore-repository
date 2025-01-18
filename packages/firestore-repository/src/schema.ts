import type { DocumentData, WriteModel } from './document.js';

export const collection = <
  DbModel extends DocumentData = DocumentData,
  AppModel extends Record<string, unknown> = Record<string, unknown>,
  Id extends Record<string, unknown> = Record<string, unknown>,
  CollectionPath extends Record<string, unknown> = Record<string, unknown>,
>(
  schema: Omit<CollectionSchema<DbModel, AppModel, Id, CollectionPath>, typeof collectionSchemaTag>,
): CollectionSchema<DbModel, AppModel, Id, CollectionPath> => ({
  [collectionSchemaTag]: true,
  ...schema,
});

export const id = <T extends string>(name: T): IdConverter<Record<T, string>> => ({
  from: (id) => {
    return { [name]: id } as Record<T, string>;
  },
  to: (id) => id[name],
});

export const numberId = <T extends string>(name: T): IdConverter<Record<T, number>> => ({
  from: (id) => {
    const numberId = Number(id);
    return { [name]: numberId } as Record<T, number>;
  },
  to: (id) => id[name].toString(),
});

export const coercible = <DbModel extends DocumentData, AppModel extends WriteModel<DbModel>>(
  from: (data: DbModel) => AppModel,
): DataConverter<DbModel, AppModel> => {
  return {
    from: (data) => from(data),
    to: (data) => data,
  };
};

export const rootCollectionPath: CollectionPathConverter<Record<never, never>> = {
  from: () => ({}),
  to: () => undefined,
};

export const subCollectionPath = <T extends CollectionSchema>(
  parent: T,
): CollectionPathConverter<Id<T>> => {
  return {
    from: ([id, ...parentPath]) => {
      if (!id) {
        throw new Error(
          `Document has no parent reference. This document is expected to have a reference to parent document of ${parent.name} collection`,
        );
      }
      return {
        ...parent.id.from(id.id),
        ...parent.collectionPath.from(parentPath),
      } as Id<T>;
    },
    to: (id) => docPath(parent, id),
  };
};

export const collectionSchemaTag: unique symbol = Symbol();

/**
 * A definition of firestore collection
 */
export type CollectionSchema<
  DbModel extends DocumentData = DocumentData,
  AppModel extends Record<string, unknown> = Record<string, unknown>,
  Id extends Record<string, unknown> = Record<string, unknown>,
  CollectionPath extends Record<string, unknown> = Record<string, unknown>,
> = {
  [collectionSchemaTag]: true;
  name: string;
  data: DataConverter<DbModel, AppModel>;
  id: IdConverter<Id>;
  collectionPath: CollectionPathConverter<CollectionPath>;
};

export type DataConverter<
  DbModel extends DocumentData = DocumentData,
  AppModel extends Record<string, unknown> = Record<string, unknown>,
> = {
  from(data: DbModel): AppModel;
  to(data: AppModel): WriteModel<DbModel>;
};
export type IdConverter<Id> = {
  from(id: string): Id;
  to(id: Id): string;
};
export type CollectionPathConverter<CollectionPath> = {
  from(id: DocPathElement[]): CollectionPath;
  to(id: CollectionPath): string | undefined;
};

/**
 * An element of the document path.
 * For example, 'User/123/Posts/456' is parsed to [{collection: 'User', id: 123}, {collection: 'Posts', id: '456'}]
 */
export type DocPathElement = {
  /**
   * Collection name
   */
  collection: string;
  /**
   * Document ID
   */
  id: string;
};

export type Prettify<T> = { [K in keyof T]: T[K] } & {};

/**
 * A full id of the document, including parent document id
 */
export type Id<T extends CollectionSchema> = T extends CollectionSchema<
  DocumentData,
  infer _AppModel,
  infer Id,
  infer CollectionPath
>
  ? Prettify<Id & CollectionPath>
  : never;

/**
 * A parent document id of the specified subcollection
 */
export type ParentId<T extends CollectionSchema> = T extends CollectionSchema<
  DocumentData,
  infer _AppModel,
  infer _IdKeys,
  infer CollectionPath
>
  ? CollectionPath
  : never;

/**
 * Derives an application model of the collection schema
 */
export type Model<T extends CollectionSchema> = T extends CollectionSchema<
  DocumentData,
  infer AppModel,
  infer Id,
  infer CollectionPath
>
  ? Prettify<AppModel & Id & CollectionPath>
  : never;

/**
 * Derives a document schema of the collection schema
 */
export type DbModel<T extends CollectionSchema> = T extends CollectionSchema<
  infer DbModel,
  infer _AppModel,
  infer _IdKeys,
  infer _ParentIdKeys
>
  ? DbModel
  : never;

/**
 * Returns a fully-qualified path of the document
 */
export const docPath = <T extends CollectionSchema>(collection: T, id: Id<T>): string => {
  const collectionPath = collection.collectionPath.to(id);
  const docPath = `${collection.name}/${collection.id.to(id)}`;
  return collectionPath ? `${collectionPath}/${docPath}` : docPath;
};

/**
 * Returns a fully-qualified path of the collection
 */
export const collectionPath = <T extends CollectionSchema>(
  collection: T,
  id: ParentId<T>,
): string => {
  const collectionPath = collection.collectionPath.to(id);
  return collectionPath ? `${collectionPath}/${collection.name}` : collection.name;
};

export type IsRootCollection<T extends CollectionSchema> = [keyof ParentId<T>] extends [never]
  ? true
  : false;
