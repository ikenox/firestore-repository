import type { StandardSchemaV1 } from '@standard-schema/spec';

import type { DocumentData, WriteDocumentData } from './document.js';
import type { ToStringTuple } from './util.js';

/**
 * A definition of a Firestore collection
 */
export type Collection<
  Data extends DocumentData = DocumentData,
  Parent extends string[] = string[],
> = { name: string; data: DocDataSchema<Data>; parent: Parent };

/** A root collection definition (no parent document) */
export type RootCollection<Data extends DocumentData = DocumentData> = Collection<Data, []>;

/** A subcollection definition (nested under a parent document) */
export type SubCollection<
  Data extends DocumentData = DocumentData,
  Parent extends [...string[], string] = [...string[], string],
> = Collection<Data, Parent>;

/** Creates a root collection definition */
export const rootCollection = <Data extends DocumentData>(params: {
  name: string;
  data: DocDataSchema<Data>;
}): Collection<Data, []> => ({ ...params, parent: [] });

/** Creates a subcollection definition */
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

/** A validation schema for document data */
export type DocDataSchema<T extends DocumentData = DocumentData> = {
  validate: (data: unknown) => T;
};

/** A document with its reference and data */
export type Doc<T extends Collection = Collection> = { ref: DocRef<T>; data: DocData<T> };

/** A document to be written, allowing write-specific field values (e.g. serverTimestamp) */
export type DocToWrite<T extends Collection> = {
  ref: DocRef<T>;
  data: DocData<T> | WriteDocumentData<DocData<T>>;
};

/** Extracts the data type from a collection definition */
export type DocData<T extends Collection> = T extends Collection<infer Data> ? Data : never;

/** A document reference represented as a tuple of document IDs */
export type DocRef<T extends Collection> = [...ParentDocRef<T>, string];

/** A parent document reference of a subcollection */
export type ParentDocRef<T extends Collection> = ToStringTuple<T['parent']>;

/** Creates a schema that skips validation and passes through data as-is */
export const schemaWithoutValidation = <T extends DocumentData>(): DocDataSchema<T> => ({
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- schema without validation
  validate: (data) => data as T,
});

/** Creates a schema from a Standard Schema validator (e.g. Zod, Valibot, ArkType) */
export const schemaFromValidator = <Data extends DocumentData>(
  schema: StandardSchemaV1<Data, Data>,
): DocDataSchema<Data> => ({
  validate: (data) => {
    const result = schema['~standard'].validate(data);
    if (result instanceof Promise) {
      throw new TypeError('Schema validation must be synchronous');
    }
    if (result.issues) {
      throw new Error('validation failed');
    }
    return result.value;
  },
});
