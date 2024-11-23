import {
  DocumentSnapshot,
  type Firestore,
  Transaction,
  type WriteBatch,
} from 'firebase-admin/firestore';
import { type CollectionSchema } from './types.js';

export type TransactionOption = { tx: Transaction };
export type WriteTransactionOption = { tx: Transaction | WriteBatch };

export abstract class Repository<T extends CollectionSchema> {
  protected constructor(
    readonly collection: T,
    readonly db: Firestore,
  ) {}

  /**
   * Get a document by ID
   */
  async get(id: T['$id'], options?: TransactionOption): Promise<T['$model'] | undefined> {
    const doc = await (options?.tx ? options.tx.get(this.docRef(id)) : this.docRef(id).get());
    return this.getData(doc);
  }

  /**
   * Create a new document
   * @throws If the document already exists
   */
  async create(doc: T['$model'], options?: WriteTransactionOption): Promise<void> {
    await (options?.tx ? options.tx.create(this.docRef(doc), doc) : this.docRef(doc).create(doc));
  }

  /**
   * Create or update
   */
  async set(doc: T['$model'], options?: WriteTransactionOption): Promise<void> {
    await (options?.tx
      ? options.tx instanceof Transaction
        ? options.tx.set(this.docRef(doc), doc)
        : options.tx.set(this.docRef(doc), doc)
      : this.docRef(doc).set(doc));
  }

  /**
   * Delete a document by ID
   */
  async delete(id: T['$id'], options?: WriteTransactionOption): Promise<void> {
    await (options?.tx ? options.tx.delete(this.docRef(id)) : this.docRef(id).delete());
  }

  /**
   * ID指定で一括取得
   * 返り値の配列は、引数に渡したIDの配列と必ず同じ長さになり、並び順も保持される
   * 例: [{id:1},{id:2},{id:5},{id:1}] -> [doc1,doc2,undefined,doc1]
   */
  async getAll(ids: T['$id'][], options?: TransactionOption): Promise<(T['$model'] | undefined)[]> {
    if (ids.length === 0) return [];
    const docRefs = ids.map((id) => this.docRef(id));
    const docs = await (options?.tx ? options.tx.getAll(...docRefs) : this.db.getAll(...docRefs));
    return docs.map((doc) => this.getData(doc));
  }

  /**
   * 一括での作成もしくは上書き
   * Firestore側の制約により500件が上限な点に注意
   */
  async batchSet(docs: T['$model'][]): Promise<void> {
    const batch = this.db.batch();
    docs.forEach((doc) => void batch.set(this.docRef(doc), doc));
    await batch.commit();
  }

  /**
   * 一括削除
   * Firestore側の制約により500件が上限な点に注意
   */
  async batchDelete(ids: T['$id'][]): Promise<void> {
    const batch = this.db.batch();
    ids.forEach((id) => void batch.delete(this.docRef(id)));
    await batch.commit();
  }

  docRef(id: T['$id']) {
    return this.collectionRef(id).doc(this.collection.docId(id));
  }

  collectionRef(id: T['$collectionPath']) {
    const path = this.collection.parent?.collectionRef(id);
    return path
      ? // subcollection
        this.db.collection(`${path}/${this.collection.name}`)
      : // root collection
        this.db.collection(this.collection.name);
  }

  getData(doc: DocumentSnapshot): T['$model'] | undefined {
    const data = doc.data();
    if (!data) {
      return undefined;
    }
    return this.collection.fromFirestore(data, doc.id, []);
  }
}
