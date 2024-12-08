import type { DocumentData, WriteModel } from './document.js';

export const collection = <
  DbModel extends DocumentData = DocumentData,
  AppModel extends Record<string, unknown> = Record<string, unknown>,
  IdKeys extends (keyof AppModel)[] = (keyof AppModel)[],
  ParentIdKeys extends (keyof AppModel)[] = [],
>(
  schema: Omit<
    CollectionSchema<DbModel, AppModel, IdKeys, ParentIdKeys>,
    typeof collectionSchemaTag
  >,
): CollectionSchema<DbModel, AppModel, IdKeys, ParentIdKeys> => ({
  [collectionSchemaTag]: true,
  ...schema,
});

export const id = <AppModel extends Record<string, unknown>, IdKey extends keyof AppModel>(
  key: IdKey,
): IdSchema<AppModel, [IdKey]> => ({
  keys: [key],
  to: (data) => `${data[key]}`,
});

export const parentPath = <AppModel extends Record<string, unknown>, IdKey extends keyof AppModel>(
  parent: CollectionSchema,
  key: IdKey,
): ParentPathSchema<AppModel, [IdKey]> => ({
  keys: [key],
  to: (data) => `${parent.name}/${data[key]}`,
});

export const collectionSchemaTag: unique symbol = Symbol();
/**
 * A definition of firestore collection
 */
export type CollectionSchema<
  DbModel extends DocumentData = DocumentData,
  AppModel extends Record<string, unknown> = Record<string, unknown>,
  IdKeys extends (keyof AppModel)[] = (keyof AppModel)[],
  ParentIdKeys extends (keyof AppModel)[] = (keyof AppModel)[],
> = {
  [collectionSchemaTag]: true;
  name: string;
  data: {
    from(data: DbModel): AppModel;
    to(data: NoInfer<AppModel>): WriteModel<NoInfer<DbModel>>;
  };
  id: IdSchema<NoInfer<AppModel>, IdKeys>;
  parentPath?: ParentPathSchema<NoInfer<AppModel>, ParentIdKeys> | undefined;
};

export type IdSchema<
  AppModel extends Record<string, unknown>,
  IdKeys extends (keyof AppModel)[],
> = {
  keys: IdKeys;
  to(id: Pick<AppModel, IdKeys[number]>): string;
};

export type ParentPathSchema<
  AppModel extends Record<string, unknown>,
  ParentIdKeys extends (keyof AppModel)[],
> = { keys: ParentIdKeys; to(id: Pick<AppModel, ParentIdKeys[number]>): string };

export type Id<T extends CollectionSchema> = T extends CollectionSchema<
  DocumentData,
  infer AppModel,
  infer IdKeys,
  infer ParentIdKeys
>
  ? Pick<AppModel, IdKeys[number] | ParentIdKeys[number]>
  : never;

export type ParentId<T extends CollectionSchema> = T extends CollectionSchema<
  DocumentData,
  infer AppModel,
  infer _IdKeys,
  infer ParentIdKeys
>
  ? Pick<AppModel, ParentIdKeys[number]>
  : never;

/**
 * Derives an application model of the collection schema
 */
export type Model<T extends CollectionSchema> = T extends CollectionSchema<
  DocumentData,
  infer AppModel,
  infer _IdKeys,
  infer _ParentIdKeys
>
  ? AppModel
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
 * Returns a path of the document
 */
export const docPath = <T extends CollectionSchema>(schema: T, id: Id<T>): string => {
  const docId = schema.id.to(id);
  return `${collectionPath(schema, id)}/${docId}`;
};

/**
 * Returns a path of the collection
 */
export const collectionPath = <T extends CollectionSchema>(schema: T, id: ParentId<T>): string => {
  return schema.parentPath ? `${schema.parentPath.to(id)}/${schema.name}` : schema.name;
};

export type IsSubCollection<T extends CollectionSchema> = [keyof ParentId<T>] extends [never]
  ? false
  : true;
