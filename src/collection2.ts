import { DocObject } from './index.js';
import { DocumentData } from './types.js';

export const collection = <
  Schema extends DocumentData,
  IdKeys extends (keyof Schema)[],
  ParentIdKeys extends (keyof Schema)[] = never,
>(
  schema: Omit<
    CollectionSchema<Schema, IdKeys, ParentIdKeys>,
    '$id' | '$object' | '$parentId' | '$schema'
  >,
): CollectionSchema<Schema, IdKeys, ParentIdKeys> =>
  schema as CollectionSchema<Schema, IdKeys, ParentIdKeys>;

/**
 * Firestoreコレクションの定義
 */
export type CollectionSchema<
  Schema extends DocumentData = DocumentData,
  IdKeys extends (keyof Schema)[] = (keyof Schema)[],
  ParentIdKeys extends (keyof Schema)[] = never,
> = {
  name: string;
  fromFirestore(data: Schema): DocObject<Schema>;
  id: {
    keys: IdKeys;
    docId(data: Pick<DocObject<Schema>, IdKeys[number]>): string;
  };
  /**
   * subcollectionの場合に指定
   */
  parentId?: {
    keys: ParentIdKeys;
    parentDocPath(data: Pick<DocObject<Schema>, ParentIdKeys[number]>): string;
  };

  // 型を参照しやすくするためのphantom types
  $schema: Schema;
  $id: Pick<DocObject<Schema>, IdKeys[number]>;
  $object: DocObject<Schema>;
  $parentId: Pick<DocObject<Schema>, ParentIdKeys[number]>;
};

const hoge = collection({
  name: 'test',
  fromFirestore: (data: { foo: string }) => data,
  id: {
    keys: ['foo'],
    docId: ({ foo }) => foo,
  },
});
