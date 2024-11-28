import {
  type CollectionReference,
  type DocumentSnapshot,
  type Firestore,
  type Query as FirestoreQuery,
  Transaction,
  type WriteBatch,
} from 'firebase-admin/firestore';
import {
  type DbModel,
  type Id,
  type Model,
  type ParentId,
  type Query,
  type Unsubscribe,
  collectionPath,
  docPath,
} from '../index.js';
import type * as base from '../index.js';

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

  async get(id: Id<T>, options?: TransactionOption): Promise<Model<T> | undefined> {
    const doc = await (options?.tx ? options.tx.get(this.docRef(id)) : this.docRef(id).get());
    return this.fromFirestore(doc);
  }

  getOnSnapshot(
    id: Model<T>,
    onNext: (snapshot: Model<T> | undefined) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe {
    return this.docRef(id).onSnapshot((snapshot) => {
      onNext(this.fromFirestore(snapshot));
    }, onError);
  }

  async list(query: Query<T>): Promise<Model<T>[]> {
    const { docs } = await (query.inner as CollectionReference).get();
    return docs.map(
      (doc) =>
        // biome-ignore lint/style/noNonNullAssertion: Query result items should have data
        this.fromFirestore(doc)!,
    );
  }

  listOnSnapshot(
    query: Query<T>,
    onNext: (snapshot: Model<T>[]) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe {
    // TODO
    return (query.inner as FirestoreQuery).onSnapshot((snapshot) => {
      // biome-ignore lint/style/noNonNullAssertion: Query result items should have data
      onNext(snapshot.docs.map((doc) => this.fromFirestore(doc)!));
    }, onError);
  }

  query(parentId: ParentId<T>): Query<T> {
    return { collection: this.collection, inner: this.collectionRef(parentId) };
  }

  collectionGroupQuery(): Query<T> {
    return { collection: this.collection, inner: this.db.collectionGroup(this.collection.name) };
  }

  /**
   * Create a new document
   * @throws If the document already exists
   *
   * TODO: Move to universal Repository interface
   */
  async create(doc: Model<T>, options?: WriteTransactionOption): Promise<void> {
    const data = this.toFirestore(doc);
    await (options?.tx ? options.tx.create(this.docRef(doc), data) : this.docRef(doc).create(data));
  }

  async set(doc: Model<T>, options?: WriteTransactionOption): Promise<void> {
    const data = this.toFirestore(doc);
    await (options?.tx
      ? options.tx instanceof Transaction
        ? options.tx.set(this.docRef(doc), data)
        : options.tx.set(this.docRef(doc), data)
      : this.docRef(doc).set(data));
  }

  async delete(id: Model<T>, options?: WriteTransactionOption): Promise<void> {
    await (options?.tx ? options.tx.delete(this.docRef(id)) : this.docRef(id).delete());
  }

  /**
   * Get documents by multiple ID
   * example: [{id:1},{id:2},{id:5},{id:1}] -> [doc1,doc2,undefined,doc1]
   */
  async batchGet(ids: Model<T>[], options?: TransactionOption): Promise<(Model<T> | undefined)[]> {
    if (ids.length === 0) {
      return [];
    }
    const docRefs = ids.map((id) => this.docRef(id));
    const docs = await (options?.tx ? options.tx.getAll(...docRefs) : this.db.getAll(...docRefs));
    return docs.map((doc) => this.fromFirestore(doc));
  }

  async batchSet(docs: Model<T>[], options?: WriteTransactionOption): Promise<void> {
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
   * Create multiple documents
   * The entire operation will fail if one creation fails
   */
  async batchCreate(docs: Model<T>[], options?: WriteTransactionOption): Promise<void> {
    await this.batchWriteOperation(
      docs,
      {
        batch: (batch, doc) => batch.create(this.docRef(doc), this.toFirestore(doc)),
        transaction: (tx, doc) => tx.create(this.docRef(doc), this.toFirestore(doc)),
      },
      options,
    );
  }

  async batchDelete(ids: Model<T>[], options?: WriteTransactionOption): Promise<void> {
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

  docRef(id: Id<T>) {
    return this.db.doc(docPath(this.collection, id));
  }

  collectionRef(parentId: ParentId<T>): CollectionReference {
    return this.db.collection(collectionPath(this.collection, parentId));
  }

  fromFirestore(doc: DocumentSnapshot): Model<T> | undefined {
    const data = doc.data();
    if (!data) {
      return undefined;
    }
    return {
      ...this.collection.data.from(data),
      ...(this.collection.parent
        ? this.collection.parent.id.from(
            // biome-ignore lint/style/noNonNullAssertion: subcollection should have parent document
            this.collection.parent.schema.id.from(doc.ref.parent.parent!.id),
          )
        : {}),
      ...this.collection.id.from(doc.id),
    } as Model<T>;
  }

  toFirestore(data: Model<T>): DbModel<T> {
    return this.collection.data.to(data) as DbModel<T>;
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
