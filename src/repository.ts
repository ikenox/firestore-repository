import {
  CollectionReference,
  DocumentSnapshot,
  type Firestore,
  Transaction,
  type WriteBatch,
} from 'firebase-admin/firestore';
import { collectionPath, docPath } from './index.js';
import type * as base from './index.js';

export type Env = { transaction: Transaction; writeBatch: WriteBatch };
export type TransactionOption = base.TransactionOption<Env>;
export type WriteTransactionOption = base.WriteTransactionOption<Env>;

export class Repository<T extends base.CollectionSchema = base.CollectionSchema>
  implements base.Repository<T, Env>
{
  constructor(
    readonly collection: T,
    readonly db: Firestore,
  ) {}

  /**
   * Get a document by ID
   */
  async get(id: T['$id'], options?: TransactionOption): Promise<T['$model'] | undefined> {
    const doc = await (options?.tx ? options.tx.get(this.docRef(id)) : this.docRef(id).get());
    return this.fromFirestore(doc);
  }

  /**
   * Create a new document
   * @throws If the document already exists
   */
  async create(doc: T['$model'], options?: WriteTransactionOption): Promise<void> {
    const data = this.toFirestore(doc);
    await (options?.tx ? options.tx.create(this.docRef(doc), data) : this.docRef(doc).create(data));
  }

  /**
   * Create or update
   */
  async set(doc: T['$model'], options?: WriteTransactionOption): Promise<void> {
    const data = this.toFirestore(doc);
    await (options?.tx
      ? options.tx instanceof Transaction
        ? options.tx.set(this.docRef(doc), data)
        : options.tx.set(this.docRef(doc), data)
      : this.docRef(doc).set(data));
  }

  /**
   * Delete a document by ID
   */
  async delete(id: T['$id'], options?: WriteTransactionOption): Promise<void> {
    await (options?.tx ? options.tx.delete(this.docRef(id)) : this.docRef(id).delete());
  }

  /**
   * Get documents by multiple ID
   * example: [{id:1},{id:2},{id:5},{id:1}] -> [doc1,doc2,undefined,doc1]
   */
  async batchGet(
    ids: T['$id'][],
    options?: TransactionOption,
  ): Promise<(T['$model'] | undefined)[]> {
    if (ids.length === 0) return [];
    const docRefs = ids.map((id) => this.docRef(id));
    const docs = await (options?.tx ? options.tx.getAll(...docRefs) : this.db.getAll(...docRefs));
    return docs.map((doc) => this.fromFirestore(doc));
  }

  /**
   * Create or update multiple documents
   * The entire operation will fail if one creation fails
   */
  async batchCreate(docs: T['$model'][], options?: WriteTransactionOption): Promise<void> {
    await this.batchWriteOperation(
      docs,
      {
        batch: (batch, doc) => batch.create(this.docRef(doc), this.toFirestore(doc)),
        transaction: (tx, doc) => tx.create(this.docRef(doc), this.toFirestore(doc)),
      },
      options,
    );
  }

  /**
   * Create or update multiple documents
   * Up to 500 documents
   */
  async batchSet(docs: T['$model'][], options?: WriteTransactionOption): Promise<void> {
    await this.batchWriteOperation(
      docs,
      {
        batch: (batch, doc) => batch.set(this.docRef(doc), this.toFirestore(doc)),
        transaction: (tx, doc) => tx.set(this.docRef(doc), this.toFirestore(doc)),
      },
      options,
    );
  }

  /**
   * Delete documents by multiple ID
   * Up to 500 documents
   */
  async batchDelete(ids: T['$id'][], options?: WriteTransactionOption): Promise<void> {
    await this.batchWriteOperation(
      ids,
      {
        batch: (batch, id) => batch.delete(this.docRef(id)),
        transaction: (tx, id) => tx.delete(this.docRef(id)),
      },
      options,
    );
  }

  protected async batchWriteOperation<U>(
    targets: U[],
    runner: {
      batch: (batch: WriteBatch, target: U) => void;
      transaction: (transaction: Transaction, target: U) => void;
    },
    options?: WriteTransactionOption,
  ): Promise<void> {
    const tx = options?.tx;
    if (tx) {
      if (tx instanceof Transaction) {
        targets.forEach((target) => runner.transaction(tx, target));
      } else {
        targets.forEach((target) => runner.batch(tx, target));
      }
    } else {
      const batch = this.db.batch();
      targets.forEach((target) => runner.batch(batch, target));
      await batch.commit();
    }
  }

  async query(parentId: T['$parentId']): Promise<T['$model'][]> {
    const { docs } = await this.collectionRef(parentId).get();
    return docs.map(
      (doc) =>
        // FIXME do not use unsafe assertion
        this.fromFirestore(doc)!,
    );
  }

  toFirestore(data: T['$model']): T['$dbModel'] {
    return this.collection.data.to(data);
  }

  docRef(id: T['$id']) {
    return this.db.doc(docPath(this.collection, id));
  }

  collectionRef(parentId: T['$parentId']) {
    return this.db.collection(collectionPath(this.collection, parentId));
  }

  fromFirestore(doc: DocumentSnapshot): T['$model'] | undefined {
    const data = doc.data();
    if (!data) {
      return undefined;
    }
    const id = this.collection.id.from(doc.id);

    const parent = this.collection.parent as CollectionSchema<never, CollectionSchema>['parent'];
    const parentId = parent ? parent.from(parent.schema.id.from(doc.ref.parent.id)) : {};
    return {
      ...this.collection.data.from(data),
      ...parentId,
      ...id,
    };
  }
}

export class IdGenerator {
  collection: CollectionReference;
  constructor(readonly db: Firestore) {
    this.collection = this.db.collection('_DUMMY_COLLECTION_FOR_ID_GENERATOR');
  }
  generate(): string {
    return this.collection.doc().id;
  }
}
