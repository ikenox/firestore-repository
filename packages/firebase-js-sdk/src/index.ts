import {
  type CollectionReference,
  type DocumentSnapshot,
  type Firestore,
  type AggregateSpec as FirestoreAggregateSpec,
  type Query as FirestoreQuery,
  type QueryFilterConstraint,
  Transaction,
  type WriteBatch,
  and,
  average,
  collection,
  count,
  deleteDoc,
  doc,
  where as firestoreWhere,
  getAggregateFromServer,
  getDoc,
  getDocs,
  onSnapshot,
  or,
  setDoc,
  sum,
  writeBatch,
} from '@firebase/firestore';
import type { FilterExpression, Query } from 'firestore-repository/query';
import type { AggregateSpec, Aggregated } from 'firestore-repository/repository';
import type * as repository from 'firestore-repository/repository';
import {
  type CollectionSchema,
  type CollectionSchema as CollectionSchema1,
  type DbModel,
  type Id,
  type Model,
  type ParentId,
  collectionPath,
  docPath,
} from 'firestore-repository/schema';
import { assertNever } from 'firestore-repository/util';

export type Env = { transaction: Transaction; writeBatch: WriteBatch; query: FirestoreQuery };
export type TransactionOption = repository.TransactionOption<Env>;
export type WriteTransactionOption = repository.WriteTransactionOption<Env>;

export class Repository<T extends CollectionSchema1 = CollectionSchema1>
  implements repository.Repository<T, Env>
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
  ): repository.Unsubscribe {
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
    const { docs } = await getDocs(query.inner);
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
  ): repository.Unsubscribe {
    return onSnapshot(query.inner, {
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

  async aggregate<T extends CollectionSchema, U extends AggregateSpec<T>>(
    query: Query<T>,
    spec: U,
  ): Promise<Aggregated<U>> {
    const aggregateSpec: FirestoreAggregateSpec = {};
    for (const [k, v] of Object.entries(spec)) {
      switch (v.kind) {
        case 'count':
          aggregateSpec[k] = count();
          break;
        case 'sum':
          aggregateSpec[k] = sum(v.path);
          break;
        case 'average':
          aggregateSpec[k] = average(v.path);
          break;
        default:
          return assertNever(v);
      }
    }

    const res = await getAggregateFromServer(query.inner, aggregateSpec);
    return res.data() as Aggregated<U>;
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

  protected docRef(id: Id<T>) {
    return doc(this.db, docPath(this.collection, id));
  }

  protected collectionRef(parentId: ParentId<T>) {
    return collection(this.db, collectionPath(this.collection, parentId));
  }

  protected fromFirestore(doc: DocumentSnapshot): Model<T> | undefined {
    const data = doc.data();
    return data ? (this.collection.data.from(data) as Model<T>) : undefined;
  }

  protected toFirestore(data: Model<T>): DbModel<T> {
    return this.collection.data.to(data) as DbModel<T>;
  }
}

const convertFilterExpression = (expr: FilterExpression): QueryFilterConstraint => {
  switch (expr.kind) {
    case 'where':
      return firestoreWhere(expr.fieldPath, expr.opStr, expr.value);
    case 'and':
      return and(...expr.filters.map(convertFilterExpression));
    case 'or':
      return or(...expr.filters.map(convertFilterExpression));
    default:
      return assertNever(expr);
  }
};

export class IdGenerator {
  collection: CollectionReference;
  constructor(readonly db: Firestore) {
    this.collection = collection(this.db, '_DUMMY_COLLECTION_FOR_ID_GENERATOR');
  }
  generate(): string {
    return doc(this.collection).id;
  }
}
