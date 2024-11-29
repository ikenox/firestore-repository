import {
  type CollectionReference,
  type DocumentSnapshot,
  type Firestore,
  type Query as FirestoreQuery,
  Transaction,
  type WriteBatch,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch,
} from '@firebase/firestore';
import {
  type DbModel,
  type Id,
  type Model,
  type ParentId,
  type Query,
  type QueryModification,
  type Unsubscribe,
  collectionPath,
  docPath,
  queryTag,
} from '../index.js';
import type * as base from '../index.js';

export type Env = { transaction: Transaction; writeBatch: WriteBatch; query: FirestoreQuery };
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
    next: (snapshot: Model<T> | undefined) => void,
    error?: (error: Error) => void,
    complete?: () => void,
  ): Unsubscribe {
    return onSnapshot(this.docRef(id), {
      next: (doc) => {
        next(this.fromFirestore(doc));
      },
      error: (e) => error?.(e),
      complete: () => {
        complete?.();
      },
    });
  }

  async list(query: Query<T>): Promise<Model<T>[]> {
    const { docs } = await getDocs(query.inner as FirestoreQuery);
    return docs.map(
      (doc) =>
        // biome-ignore lint/style/noNonNullAssertion: query result item should not be null
        this.fromFirestore(doc)!,
    );
  }

  listOnSnapshot(
    query: Query<T>,
    next: (snapshot: Model<T>[]) => void,
    error?: (error: Error) => void,
    complete?: () => void,
  ): Unsubscribe {
    return onSnapshot(query.inner as FirestoreQuery, {
      next: ({ docs }) => {
        // biome-ignore lint/style/noNonNullAssertion: query result item should not be null
        next(docs.map((doc) => this.fromFirestore(doc)!));
      },
      error: (e) => error?.(e),
      complete: () => {
        complete?.();
      },
    });
  }

  query(
    parentIdOrQuery: ParentId<T> | Query<T, Env>,
    modify?: QueryModification<T, Env>,
  ): Query<T, Env> {
    const query =
      queryTag in parentIdOrQuery ? parentIdOrQuery.inner : this.collectionRef(parentIdOrQuery);
    return {
      [queryTag]: true,
      collection: this.collection,
      inner: modify?.(query) ?? query,
    };
  }

  collectionGroupQuery(modify?: QueryModification<T, Env>): Query<T, Env> {
    const query = collectionGroup(this.db, this.collection.name);
    return {
      [queryTag]: true,
      collection: this.collection,
      inner: modify?.(query) ?? query,
    };
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
