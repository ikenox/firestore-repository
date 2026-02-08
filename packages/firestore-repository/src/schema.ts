import type { DocumentData, WriteDocumentData } from './document.js';
import type { ToStringTuple } from './util.js';

/**
 * A definition of firestore collection
 */
export type Collection<
  Data extends DocumentData = DocumentData,
  Parent extends string[] = string[],
> = { name: string; data: DocDataSchema<Data>; parent: Parent };

export type RootCollection<Data extends DocumentData = DocumentData> = Collection<Data, []>;

export type SubCollection<
  Data extends DocumentData = DocumentData,
  Parent extends [...string[], string] = [...string[], string],
> = Collection<Data, Parent>;

export const rootCollection = <Data extends DocumentData>(params: {
  name: string;
  data: DocDataSchema<Data>;
}): Collection<Data, []> => ({ ...params, parent: [] });

export const subCollection = <
  Data extends DocumentData,
  const Parent extends [...string[], string],
>(params: {
  name: string;
  data: DocDataSchema<Data>;
  parent: Parent;
}): SubCollection<Data, Parent> => {
  return params;
};

export type DocDataSchema<T extends DocumentData = DocumentData> = {
  validate: (data: unknown) => T;
};

export type Doc<T extends Collection = Collection> = { ref: DocRef<T>; data: DocData<T> };

export type DocToWrite<T extends Collection> = {
  ref: DocRef<T>;
  data: DocData<T> | WriteDocumentData<DocData<T>>;
};

export type DocData<T extends Collection> = T extends Collection<infer Data> ? Data : never;

export type DocRef<T extends Collection> = [...ParentDocRef<T>, string];

export type ParentDocRef<T extends Collection> = ToStringTuple<T['parent']>;

export const schemaWithoutValidation = <T extends DocumentData>(): DocDataSchema<T> => ({
  // biome-ignore lint/plugin/no-type-assertion: schema without validation
  validate: (data) => data as T,
});
