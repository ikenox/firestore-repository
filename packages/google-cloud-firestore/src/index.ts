import {
  AggregateField,
  type CollectionReference,
  type DocumentSnapshot,
  Filter,
  type Firestore,
  type AggregateSpec as FirestoreAggregateSpec,
  type Query as FirestoreQuery,
  Transaction,
  type WriteBatch,
} from '@google-cloud/firestore';
import type { FilterExpression, Query } from 'firestore-repository/query';
import type { AggregateSpec, Aggregated } from 'firestore-repository/repository';
import type * as repository from 'firestore-repository/repository';
import {
  type CollectionSchema,
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

export class Repository<T extends CollectionSchema = CollectionSchema>
  implements repository.Repository<T, Env>
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
    id: Id<T>,
    next: (snapshot: Model<T> | undefined) => void,
    error?: (error: Error) => void,
  ): repository.Unsubscribe {
    return this.docRef(id).onSnapshot((snapshot) => {
      next(this.fromFirestore(snapshot));
    }, error);
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
    next: (snapshot: Model<T>[]) => void,
    error?: (error: Error) => void,
  ): repository.Unsubscribe {
    // TODO
    return (query.inner as FirestoreQuery).onSnapshot((snapshot) => {
      // biome-ignore lint/style/noNonNullAssertion: Query result items should have data
      next(snapshot.docs.map((doc) => this.fromFirestore(doc)!));
    }, error);
  }

  async aggregate<T extends CollectionSchema, U extends AggregateSpec<T>>(
    query: Query<T, Env>,
    spec: U,
  ): Promise<Aggregated<U>> {
    const aggregateSpec: FirestoreAggregateSpec = {};
    for (const [k, v] of Object.entries(spec)) {
      switch (v.kind) {
        case 'count':
          aggregateSpec[k] = AggregateField.count();
          break;
        case 'sum':
          aggregateSpec[k] = AggregateField.sum(v.path);
          break;
        case 'average':
          aggregateSpec[k] = AggregateField.average(v.path);
          break;
        default:
          return assertNever(v);
      }
    }

    const res = await query.inner.aggregate(aggregateSpec).get();
    return res.data() as Aggregated<U>;
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

  async delete(id: Id<T>, options?: WriteTransactionOption): Promise<void> {
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
      const batch = this.db.batch();
      targets.forEach((target) => runner.batch(batch, target));
      await batch.commit();
    }
  }

  protected docRef(id: Id<T>) {
    return this.db.doc(docPath(this.collection, id));
  }

  protected collectionRef(parentId: ParentId<T>): CollectionReference {
    return this.db.collection(collectionPath(this.collection, parentId));
  }

  protected fromFirestore(doc: DocumentSnapshot): Model<T> | undefined {
    const data = doc.data();
    return data ? (this.collection.data.from(data) as Model<T>) : undefined;
  }

  protected toFirestore(data: Model<T>): DbModel<T> {
    return this.collection.data.to(data) as DbModel<T>;
  }
}

const convertFilterExpression = (expr: FilterExpression): Filter => {
  switch (expr.kind) {
    case 'where':
      return Filter.where(expr.fieldPath, expr.opStr, expr.value);
    case 'and':
      return Filter.and(...expr.filters.map(convertFilterExpression));
    case 'or':
      return Filter.or(...expr.filters.map(convertFilterExpression));
    default:
      return assertNever(expr);
  }
};

/**
 * A query offset constraint
 * TODO
 */
// export type Offset = <T extends CollectionSchema>(limit: number) => QueryConstraint<Query<T, Env>>;
//
// export const offset: Offset = (offset) => (q) => q.offset(offset);

export class IdGenerator {
  collection: CollectionReference;
  constructor(readonly db: Firestore) {
    this.collection = this.db.collection('_DUMMY_COLLECTION_FOR_ID_GENERATOR');
  }
  generate(): string {
    return this.collection.doc().id;
  }
}
