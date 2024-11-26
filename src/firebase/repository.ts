import {
  CollectionReference,
  DocumentSnapshot,
  type Firestore,
  Transaction,
  type WriteBatch,
  addDoc,
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
import { Unsubscribe, collectionPath, docPath } from '../index.js';
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

  async get(id: T['$id'], options?: TransactionOption): Promise<T['$model'] | undefined> {
    const doc = await (options?.tx ? options.tx.get(this.docRef(id)) : getDoc(this.docRef(id)));
    return this.fromFirestore(doc);
  }

  async query(parentId: T['$parentId']): Promise<T['$model'][]> {
    const { docs } = await getDocs(query(this.collectionRef(parentId)));
    return docs.map(
      (doc) =>
        // FIXME do not use unsafe assertion
        this.fromFirestore(doc)!,
    );
  }

  getOnShanpshot(
    id: T['$id'],
    onNext: (snapshot: T['$model'] | undefined) => void,
    onError?: (error: Error) => void,
    complete?: () => void,
  ): Unsubscribe {}

  queryOnSnapshot(
    id: T['$parentId'],
    onNext: (snapshot: T['$model'][]) => void,
    onError?: (error: Error) => void,
    complete?: () => void,
  ): Unsubscribe {
    query();
  }

  async create(doc: T['$model'], options?: WriteTransactionOption): Promise<void> {
    executeWrite();
    addDoc();
    const data = this.toFirestore(doc);
    await (options?.tx
      ? options.tx.create(this.docRef(doc), data)
      : addDoc(this.docRef(doc), data));
  }

  async set(doc: T['$model'], options?: WriteTransactionOption): Promise<void> {
    const data = this.toFirestore(doc);
    await (options?.tx
      ? options.tx instanceof Transaction
        ? options.tx.set(this.docRef(doc), data)
        : options.tx.set(this.docRef(doc), data)
      : setDoc(this.docRef(doc), data));
  }

  async delete(id: T['$id'], options?: WriteTransactionOption): Promise<void> {
    await (options?.tx ? options.tx.delete(this.docRef(id)) : deleteDoc(this.docRef(id)));
  }

  async batchGet(
    ids: T['$id'][],
    options?: TransactionOption,
  ): Promise<(T['$model'] | undefined)[]> {
    if (ids.length === 0) return [];
    const docRefs = ids.map((id) => this.docRef(id));
    const docs = await (options?.tx ? options.tx.getAll(...docRefs) : this.db.getAll(...docRefs));
    return docs.map((doc) => this.fromFirestore(doc));
  }

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
      const batch = writeBatch(this.db);
      targets.forEach((target) => runner.batch(batch, target));
      await batch.commit();
    }
  }

  toFirestore(data: T['$model']): T['$dbModel'] {
    return this.collection.data.to(data);
  }

  docRef(id: T['$id']) {
    return doc(this.db, docPath(this.collection, id));
  }

  collectionRef(parentId: T['$parentId']) {
    return collection(this.db, collectionPath(this.collection, parentId));
  }

  fromFirestore(doc: DocumentSnapshot): T['$model'] | undefined {
    const data = doc.data();
    if (!data) {
      return undefined;
    }
    const id = this.collection.id.from(doc.id);

    const parent = this.collection.parent as base.CollectionSchema<
      never,
      base.CollectionSchema
    >['parent'];
    const parentId = parent ? parent.id.from(parent.schema.id.from(doc.ref.parent.parent!.id)) : {};
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
    this.collection = collection(this.db, '_DUMMY_COLLECTION_FOR_ID_GENERATOR');
  }
  generate(): string {
    return doc(this.collection).id;
  }
}
