import type { DocumentData, WriteDocumentData } from './document.js';

/**
 * A definition of firestore collection
 */
export type Collection<
  Data extends DocumentData = DocumentData,
  // biome-ignore lint/suspicious/noExplicitAny: avoid circular reference
  Parent extends Collection | undefined = any,
> = { name: string; data: DocDataSchema<Data>; parent: Parent };

export const rootCollection = <Data extends DocumentData>(params: {
  name: string;
  data: DocDataSchema<Data>;
}): Collection<Data, undefined> => ({ ...params, parent: undefined });

export const subCollection = <Data extends DocumentData, Parent extends Collection>(params: {
  name: string;
  data: DocDataSchema<Data>;
  parent: Parent;
}): Collection<Data, Parent> => params;

export type DocDataSchema<T extends DocumentData = DocumentData> = {
  validate: (data: unknown) => T;
};

export type Doc<T extends Collection = Collection> = DocRef<T> & { data: DocData<T> };

export type DocToWrite<T extends Collection> = DocRef<T> & {
  data: DocData<T> | WriteDocumentData<DocData<T>>;
};

export type DocData<T extends Collection> = T extends Collection<infer Data> ? Data : never;

// TODO: DocRef can be just an array of string id
export type DocRef<T extends Collection = Collection> = T['parent'] extends Collection
  ? { id: string; parent: DocRef<T['parent']> }
  : { id: string; parent?: undefined };

export const schemaWithoutValidation = <T extends DocumentData>(): DocDataSchema<T> => ({
  // biome-ignore lint/plugin/no-type-assertion: schema without validation
  validate: (data) => data as T,
});
