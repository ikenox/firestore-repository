import {
  AggregateField,
  type DocumentReference,
  type DocumentSnapshot,
  Filter,
  type Firestore,
  type AggregateSpec as FirestoreAggregateSpec,
  type Query as FirestoreQuery,
  Transaction,
  type WriteBatch,
} from '@google-cloud/firestore';
import type { AggregateQuery, Aggregated } from 'firestore-repository/aggregate';
import type { WriteDocumentData } from 'firestore-repository/document';
import type { FilterExpression, Offset, Query } from 'firestore-repository/query';
import type * as repository from 'firestore-repository/repository';
import {
  type CollectionSchema,
  type DocPathElement,
  type Id,
  type Model,
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
    const { docs } = await toFirestoreQuery(this.db, query).get();
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
    return toFirestoreQuery(this.db, query).onSnapshot((snapshot) => {
      // biome-ignore lint/style/noNonNullAssertion: Query result items should have data
      next(snapshot.docs.map((doc) => this.fromFirestore(doc)!));
    }, error);
  }

  async aggregate<U extends AggregateQuery<T>>(aggregate: U): Promise<Aggregated<U>> {
    const aggregateSpec: FirestoreAggregateSpec = {};
    for (const [k, v] of Object.entries(aggregate.spec)) {
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

    const res = await toFirestoreQuery(this.db, aggregate.query).aggregate(aggregateSpec).get();
    return res.data() as Aggregated<U>;
  }

  /**
   * Create a new document
   * @throws If the document already exists
   */
  async create(doc: Model<T>, options?: WriteTransactionOption): Promise<void> {
    const data = this.toFirestoreData(doc);
    await (options?.tx ? options.tx.create(this.docRef(doc), data) : this.docRef(doc).create(data));
  }

  async set(doc: Model<T>, options?: WriteTransactionOption): Promise<void> {
    const data = this.toFirestoreData(doc);
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
  async batchGet(ids: Id<T>[], options?: TransactionOption): Promise<(Model<T> | undefined)[]> {
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
        batch: (batch, doc) => batch.set(this.docRef(doc), this.toFirestoreData(doc)),
        transaction: (tx, doc) => tx.set(this.docRef(doc), this.toFirestoreData(doc)),
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
        batch: (batch, doc) => batch.create(this.docRef(doc), this.toFirestoreData(doc)),
        transaction: (tx, doc) => tx.create(this.docRef(doc), this.toFirestoreData(doc)),
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

  protected fromFirestore(doc: DocumentSnapshot): Model<T> | undefined {
    const data = doc.data();
    const [id, ...parentPath] = docPathElements(doc.ref);
    return data
      ? ({
          ...this.collection.data.from(data),
          ...this.collection.collectionPath.from(parentPath),
          ...this.collection.id.from(id.id),
        } as Model<T>)
      : undefined;
  }

  protected toFirestoreData(data: Model<T>): WriteDocumentData {
    return this.collection.data.to(data);
  }
}

/**
 * Obtain document path elements from DocumentReference
 */
export const docPathElements = (doc: DocumentReference): [DocPathElement, ...DocPathElement[]] => {
  const parentPath: DocPathElement[] = [];
  let cursor = doc.parent.parent;
  while (cursor) {
    parentPath.push({ id: cursor.id, collection: cursor.parent.id });
    cursor = cursor.parent.parent;
  }
  return [{ collection: doc.parent.id, id: doc.id }, ...parentPath];
};

// OPTIMIZE: cache query
export const toFirestoreQuery = (db: Firestore, query: Query): FirestoreQuery => {
  let base: FirestoreQuery;
  switch (query.base.kind) {
    case 'collection':
      base = db.collection(collectionPath(query.base.collection, query.base.parentId));
      break;
    case 'collectionGroup':
      base = db.collectionGroup(query.base.collection.name);
      break;
    case 'extends':
      base = toFirestoreQuery(db, query.base.query);
      break;
    default:
      base = assertNever(query.base);
  }
  return (
    query.constraints?.reduce((q, constraint) => {
      switch (constraint.kind) {
        case 'where':
          return q.where(toFirestoreFilter(constraint.filter));
        case 'orderBy':
          return q.orderBy(constraint.field, constraint.direction);
        case 'limit':
          return q.limit(constraint.limit);
        case 'limitToLast':
          return q.limitToLast(constraint.limit);
        case 'offset':
          return q.offset(constraint.offset);
        case 'startAt': {
          const { cursor } = constraint;
          return q.startAt(...cursor);
        }
        case 'startAfter': {
          const { cursor } = constraint;
          return q.startAfter(...cursor);
        }
        case 'endAt': {
          const { cursor } = constraint;
          return q.endAt(...cursor);
        }
        case 'endBefore': {
          const { cursor } = constraint;
          return q.endBefore(...cursor);
        }
        default:
          return assertNever(constraint);
      }
    }, base) ?? base
  );
};

export const toFirestoreFilter = (expr: FilterExpression): Filter => {
  switch (expr.kind) {
    case 'where':
      return Filter.where(expr.fieldPath, expr.opStr, expr.value);
    case 'and':
      return Filter.and(...expr.filters.map(toFirestoreFilter));
    case 'or':
      return Filter.or(...expr.filters.map(toFirestoreFilter));
    default:
      return assertNever(expr);
  }
};

/**
 * A query offset constraint
 */
export const offset = (offset: number): Offset => ({ kind: 'offset', offset });
