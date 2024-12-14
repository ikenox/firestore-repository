import {
  type DocumentSnapshot,
  type Firestore,
  type AggregateSpec as FirestoreAggregateSpec,
  type Query as FirestoreQuery,
  type QueryFilterConstraint as FirestoreQueryFilterConstraint,
  QueryCompositeFilterConstraint,
  type QueryFilterConstraint,
  type QueryNonFilterConstraint,
  Transaction,
  type WriteBatch,
  and,
  average,
  collection,
  collectionGroup,
  count,
  deleteDoc,
  doc,
  endAt,
  endBefore,
  query as firestoreQuery,
  getAggregateFromServer,
  getDoc,
  getDocs,
  limit,
  limitToLast,
  onSnapshot,
  or,
  orderBy,
  setDoc,
  startAfter,
  startAt,
  sum,
  where,
  writeBatch,
} from '@firebase/firestore';
import type { AggregateQuery, Aggregated } from 'firestore-repository/aggregate';
import type { FilterExpression, Query } from 'firestore-repository/query';
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
    const { docs } = await getDocs(toFirestoreQuery(this.db, query));
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
    return onSnapshot(toFirestoreQuery(this.db, query), {
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

  async aggregate<U extends AggregateQuery<T>>(aggregate: U): Promise<Aggregated<U>> {
    const aggregateSpec: FirestoreAggregateSpec = {};
    for (const [k, v] of Object.entries(aggregate.spec)) {
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

    const res = await getAggregateFromServer(
      toFirestoreQuery(this.db, aggregate.query),
      aggregateSpec,
    );
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

export const toFirestoreQuery = (db: Firestore, query: Query): FirestoreQuery => {
  const { filter, nonFilter } = (query.constraints ?? []).reduce<{
    filter?: QueryFilterConstraint | QueryCompositeFilterConstraint;
    nonFilter: QueryNonFilterConstraint[];
  }>(
    (acc, constraint) => {
      switch (constraint.kind) {
        case 'where': {
          const filter = toFirestoreQueryFilterConstraint(constraint.filter);
          acc.filter = acc.filter ? and(acc.filter, filter) : filter;
          break;
        }
        case 'orderBy':
          acc.nonFilter.push(orderBy(constraint.field, constraint.direction));
          break;
        case 'limit':
          acc.nonFilter.push(limit(constraint.limit));
          break;
        case 'limitToLast':
          acc.nonFilter.push(limitToLast(constraint.limit));
          break;
        case 'offset':
          // https://github.com/firebase/firebase-js-sdk/issues/479
          throw new Error('firestore-js-sdk does not support offset constraint');
        case 'startAt': {
          const { cursor } = constraint;
          acc.nonFilter.push(startAt(...cursor));
          break;
        }
        case 'startAfter': {
          const { cursor } = constraint;
          acc.nonFilter.push(startAfter(...cursor));
          break;
        }
        case 'endAt': {
          const { cursor } = constraint;
          acc.nonFilter.push(endAt(...cursor));
          break;
        }
        case 'endBefore': {
          const { cursor } = constraint;
          acc.nonFilter.push(endBefore(...cursor));
          break;
        }
        default:
          return assertNever(constraint);
      }
      return acc;
    },
    { nonFilter: [] },
  );

  let base: FirestoreQuery;
  switch (query.base.kind) {
    case 'collection':
      base = collection(db, collectionPath(query.base.collection, query.base.parentId));
      break;
    case 'collectionGroup':
      base = collectionGroup(db, query.base.collection.name);
      break;
    case 'extends':
      base = toFirestoreQuery(db, query.base.query);
      break;
    default:
      base = assertNever(query.base);
  }

  return filter
    ? filter instanceof QueryCompositeFilterConstraint
      ? firestoreQuery(base, filter, ...nonFilter)
      : firestoreQuery(base, filter, ...nonFilter)
    : firestoreQuery(base, ...nonFilter);
};

const toFirestoreQueryFilterConstraint = (
  expr: FilterExpression,
): FirestoreQueryFilterConstraint => {
  switch (expr.kind) {
    case 'where':
      return where(expr.fieldPath, expr.opStr, expr.value);
    case 'or':
      return or(...expr.filters.map(toFirestoreQueryFilterConstraint));
    case 'and':
      return and(...expr.filters.map(toFirestoreQueryFilterConstraint));
    default:
      return assertNever(expr);
  }
};
