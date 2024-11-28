import {
  type CollectionReference,
  type DocumentSnapshot,
  type Firestore,
  Transaction,
  type WriteBatch,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  writeBatch,
} from '@firebase/firestore';
import {
  type DbModel,
  type Id,
  type Model,
  type ParentId,
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
    const doc = await (options?.tx ? options.tx.get(this.docRef(id)) : getDoc(this.docRef(id)));
    return this.fromFirestore(doc);
  }

  getOnSnapshot(
    id: Id<T>,
    onNext: (snapshot: Model<T> | undefined) => void,
    onError?: (error: Error) => void,
    complete?: () => void,
  ): Unsubscribe {
    return onSnapshot(this.docRef(id), onNext, onError, complete);
  }

  async list(parentId: ParentId<T>): Promise<Model<T>[]> {
    const { docs } = await getDocs(query(this.collectionRef(parentId)));
    return docs.map(
      (doc) =>
        // FIXME do not use unsafe assertion
        // biome-ignore lint/style/noNonNullAssertion: <explanation>
        this.fromFirestore(doc)!,
    );
  }

  listOnSnapshot(
    id: ParentId<T>,
    onNext: (snapshot: Model<T>[]) => void,
    onError?: (error: Error) => void,
    complete?: () => void,
  ): Unsubscribe {
    // TODO
    return () => {};
  }

  async set(doc: Model<T>, options?: WriteTransactionOption): Promise<void> {
    const data = this.toFirestore(doc);
    await (options?.tx
      ? options.tx instanceof Transaction
        ? options.tx.set(this.docRef(doc), data)
        : options.tx.set(this.docRef(doc), data)
      : setDoc(this.docRef(doc), data));
  }

  async delete(id: Id<T>, options?: WriteTransactionOption): Promise<void> {
    await (options?.tx ? options.tx.delete(this.docRef(id)) : deleteDoc(this.docRef(id)));
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

  async batchDelete(ids: Id<T>[], options?: WriteTransactionOption): Promise<void> {
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
      const batch = writeBatch(this.db);
      targets.forEach((target) => runner.batch(batch, target));
      await batch.commit();
    }
  }

  docRef(id: Id<T>) {
    return doc(this.db, docPath(this.collection, id));
  }

  collectionRef(parentId: ParentId<T>) {
    return collection(this.db, collectionPath(this.collection, parentId));
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
    this.collection = collection(this.db, '_DUMMY_COLLECTION_FOR_ID_GENERATOR');
  }
  generate(): string {
    return doc(this.collection).id;
  }
}
