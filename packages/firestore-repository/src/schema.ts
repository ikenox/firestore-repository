import type { DocumentData, WriteDocumentData } from './document.js';

/**
 * A utility method to define a root collection schema.
 */
export const rootCollection = <
  DbModel extends DocumentData,
  AppModel extends Record<string, unknown>,
  AppModelId extends Record<string, unknown>,
>(
  schema: Omit<
    CollectionSchema<DbModel, AppModel, AppModelId>,
    typeof collectionSchemaBrand | 'collectionPath'
  >,
): CollectionSchema<DbModel, AppModel, AppModelId, Record<never, never>> =>
  collection({
    collectionPath: rootCollectionPath,
    ...schema,
  });

/**
 * A utility method to define a subcollection schema.
 */
export const subCollection = <
  DbModel extends DocumentData,
  AppModel extends Record<string, unknown>,
  AppModelId extends Record<string, unknown>,
  Parent extends CollectionSchema,
>(
  schema: Omit<
    CollectionSchema<DbModel, AppModel, AppModelId>,
    typeof collectionSchemaBrand | 'collectionPath'
  >,
  parent: Parent,
): CollectionSchema<DbModel, AppModel, AppModelId, Id<Parent>> =>
  collection({
    collectionPath: subCollectionPath(parent),
    ...schema,
  });

/**
 * A base method of defining a collection schema.
 * Normally it's useful to use `rootCollection` or `subCollection` method instead.
 */
export const collection = <
  DbModel extends DocumentData = DocumentData,
  AppModel extends Record<string, unknown> = Record<string, unknown>,
  Id extends Record<string, unknown> = Record<string, unknown>,
  CollectionPath extends Record<string, unknown> = Record<string, unknown>,
>(
  schema: Omit<
    CollectionSchema<DbModel, AppModel, Id, CollectionPath>,
    typeof collectionSchemaBrand
  >,
): CollectionSchema<DbModel, AppModel, Id, CollectionPath> => ({
  [collectionSchemaBrand]: true,
  ...schema,
});

/**
 * A shorthand utility to define simple id field, that just maps a document id into single field of the model.
 */
export const mapTo = <T extends string>(fieldName: T): IdConverter<Record<T, string>> => ({
  from: (id) => {
    return { [fieldName]: id } as Record<T, string>;
  },
  to: (id) => id[fieldName],
});

/**
 * A shorthand utility to define simple id field, that just converts a document id into number and maps it into single field of the model.
 */
export const numberId = <T extends string>(fieldName: T): IdConverter<Record<T, number>> => ({
  from: (id) => {
    const numberId = Number(id);
    return { [fieldName]: numberId } as Record<T, number>;
  },
  to: (id) => id[fieldName].toString(),
});

/**
 * A most simple data converter that does nothing.
 */
export const data = <DbModel extends DocumentData>(): DataConverter<DbModel, DbModel> => ({
  from: (data: DbModel): DbModel => data,
  // FIXME return value should be valid without type assertion
  to: (data: DbModel): WriteDocumentData<DbModel> => data as WriteDocumentData<DbModel>,
});

/**
 * Defines both of firestore data schema and app model at once to the extent that implicit conversion is possible.
 * Normally it's needed to define two-way conversion between firestore and app model, but if the app
 * model keeps a firestore-compatible data format, you can use this method that requires only one-way
 * definition. The app model should be the same form of the firestore document schema.
 * A common use-case is just converting firestore Timestamp value to Date value.
 */
export const implicit = <DbModel extends DocumentData, AppModel extends WriteDocumentData<DbModel>>(
  from: (data: DbModel) => AppModel,
): DataConverter<DbModel, AppModel> => {
  return {
    from: (data) => from(data),
    to: (data) => data,
  };
};

/**
 * A root collection path definition.
 */
export const rootCollectionPath: CollectionPathConverter<Record<never, never>> = {
  from: () => ({}),
  to: () => undefined,
};

/**
 * A subcollection path definition.
 */
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

export const collectionSchemaBrand: unique symbol = Symbol();

/**
 * A definition of firestore collection
 */
export type CollectionSchema<
  DbModel extends DocumentData = DocumentData,
  AppModel extends Record<string, unknown> = Record<string, unknown>,
  Id extends Record<string, unknown> = Record<string, unknown>,
  CollectionPath extends Record<string, unknown> = Record<string, unknown>,
> = {
  [collectionSchemaBrand]: unknown;
  name: string;
  id: IdConverter<Id>;
  data: DataConverter<DbModel, AppModel>;
  collectionPath: CollectionPathConverter<CollectionPath>;
};

/**
 * A data converter for the document data part
 */
export type DataConverter<
  DbModel extends DocumentData = DocumentData,
  AppModel extends Record<string, unknown> = Record<string, unknown>,
> = {
  from(data: DbModel): AppModel;
  to(data: AppModel): WriteDocumentData<DbModel>;
};

/**
 * A data converter for the document id part
 */
export type IdConverter<Id> = {
  from(id: string): Id;
  to(id: Id): string;
};

/**
 * A data converter for the document parent path part
 */
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

/**
 * Checks if the collection is a root collection
 */
export type IsRootCollection<T extends CollectionSchema> = [keyof ParentId<T>] extends [never]
  ? true
  : false;
