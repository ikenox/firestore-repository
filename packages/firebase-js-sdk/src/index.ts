import type {
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  AggregateSpec as FirestoreAggregateSpec,
  Query as FirestoreQuery,
  QueryFilterConstraint as FirestoreQueryFilterConstraint,
  QueryNonFilterConstraint,
  WriteBatch,
} from '@firebase/firestore';
import {
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
  Transaction,
  where,
  writeBatch,
} from '@firebase/firestore';
import type { Aggregated, AggregateSpec } from 'firestore-repository/aggregate';
import { collectionPath, documentPath } from 'firestore-repository/path';
import type { FilterExpression, Query } from 'firestore-repository/query';
import {
  type AppModel,
  type Mapper,
  type PlainModel,
  plainMapper,
  type Repository,
  type TransactionOption,
  type Unsubscribe,
  type WriteTransactionOption,
} from 'firestore-repository/repository';
import type { Collection, Doc, DocData, DocRef } from 'firestore-repository/schema';
import { assertNever } from 'firestore-repository/util';

export type Env = { transaction: Transaction; writeBatch: WriteBatch; query: FirestoreQuery };

export const newRepository = <T extends Collection>(
  db: Firestore,
  collection: T,
): Repository<T, PlainModel<T>, Env> =>
  newRepositoryWithMapper(db, collection, plainMapper(collection));

export const newRepositoryWithMapper = <T extends Collection, Model extends AppModel>(
  db: Firestore,
  collection: T,
  mapper: Mapper<T, Model>,
): Repository<T, Model, Env> => {
  const { toFirestore, fromFirestore, batchWriteOperation } = buildFirestoreUtilities(
    db,
    collection,
  );

  return {
    collection,

    get: async (
      ref: Model['id'],
      options?: TransactionOption<Env>,
    ): Promise<Model['read'] | undefined> => {
      const docRef = toFirestore.docRef(mapper.toDocRef(ref));
      const documentSnapshot = await (options?.tx ? options.tx.get(docRef) : getDoc(docRef));
      const doc = fromFirestore.document(documentSnapshot);
      if (!doc) {
        return undefined;
      }
      return mapper.fromFirestore(doc);
    },

    getOnSnapshot: (
      ref: Model['id'],
      next: (snapshot: Model['read'] | undefined) => void,
      error?: (error: Error) => void,
    ): Unsubscribe => {
      const docRef = toFirestore.docRef(mapper.toDocRef(ref));
      return onSnapshot(docRef, {
        next: (snapshot) => {
          const doc = fromFirestore.document(snapshot);
          next(doc ? mapper.fromFirestore(doc) : undefined);
        },
        error: (e) => error?.(e),
      });
    },

    list: async (query: Query<T>): Promise<Model['read'][]> => {
      const firestoreQueryObj = toFirestore.query(query);
      const { docs } = await getDocs(firestoreQueryObj);
      return docs.map((doc) => mapper.fromFirestore(fromFirestore.documentMustExist(doc)));
    },

    listOnSnapshot: (
      query: Query<T>,
      next: (snapshot: Model['read'][]) => void,
      error?: (error: Error) => void,
    ): Unsubscribe => {
      const firestoreQueryObj = toFirestore.query(query);
      return onSnapshot(firestoreQueryObj, {
        next: ({ docs }) =>
          next(docs.map((doc) => mapper.fromFirestore(fromFirestore.documentMustExist(doc)))),
        error: (e) => error?.(e),
      });
    },

    aggregate: async <U extends AggregateSpec<T>>(
      query: Query<T>,
      spec: U,
    ): Promise<Aggregated<U>> => {
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

      const firestoreQueryObj = toFirestore.query(query);
      const res = await getAggregateFromServer(firestoreQueryObj, aggregateSpec);
      // biome-ignore lint/plugin/no-type-assertion: there is no way to infer correct type
      return res.data() as Aggregated<U>;
    },

    set: async (model: Model['write'], options?: WriteTransactionOption<Env>): Promise<void> => {
      const docToWrite = mapper.toFirestore(model);
      const docRef = toFirestore.docRef(docToWrite);
      await (options?.tx
        ? options.tx instanceof Transaction
          ? options.tx.set(docRef, docToWrite.data)
          : options.tx.set(docRef, docToWrite.data)
        : setDoc(docRef, docToWrite.data));
    },

    delete: async (ref: Model['id'], options?: WriteTransactionOption<Env>): Promise<void> => {
      const docRef = toFirestore.docRef(mapper.toDocRef(ref));
      await (options?.tx ? options.tx.delete(docRef) : deleteDoc(docRef));
    },

    batchSet: async (
      models: Model['write'][],
      options?: WriteTransactionOption<Env>,
    ): Promise<void> => {
      const docs = models.map(mapper.toFirestore);
      await batchWriteOperation(
        docs,
        {
          batch: (batch, d) => batch.set(toFirestore.docRef(d), d.data),
          transaction: (tx, d) => tx.set(toFirestore.docRef(d), d.data),
        },
        options,
      );
    },

    batchDelete: async (
      refs: Model['id'][],
      options?: WriteTransactionOption<Env>,
    ): Promise<void> => {
      const docRefs = refs.map(mapper.toDocRef);
      await batchWriteOperation(
        docRefs,
        {
          batch: (batch, ref) => batch.delete(toFirestore.docRef(ref)),
          transaction: (tx, ref) => tx.delete(toFirestore.docRef(ref)),
        },
        options,
      );
    },
  };
};

const buildFirestoreUtilities = <T extends Collection>(db: Firestore, coll: T) => {
  const toFirestore = {
    docRef: (ref: DocRef<T>): DocumentReference => doc(db, documentPath(coll, ref)),
    query: (query: Query<T>): FirestoreQuery => {
      let base: FirestoreQuery;
      if ('collection' in query.base) {
        base = query.base.group
          ? collectionGroup(db, query.base.collection.name)
          : collection(db, collectionPath(query.base.collection, query.base.parent));
      } else if ('extends' in query.base) {
        base = toFirestore.query(query.base.extends);
      } else {
        return assertNever(query.base);
      }

      if (!query.constraints || query.constraints.length === 0) {
        return base;
      }

      const { filter, nonFilter } = query.constraints.reduce<{
        filter?: FirestoreQueryFilterConstraint;
        nonFilter: QueryNonFilterConstraint[];
      }>(
        (acc, constraint) => {
          switch (constraint.kind) {
            case 'where':
            case 'and':
            case 'or': {
              const f = toFirestore.filter(constraint);
              acc.filter = acc.filter ? and(acc.filter, f) : f;
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
              throw new Error('firebase-js-sdk does not support offset constraint');
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

      // Wrap single filter in and() to satisfy QueryCompositeFilterConstraint overload
      return filter
        ? firestoreQuery(base, and(filter), ...nonFilter)
        : firestoreQuery(base, ...nonFilter);
    },
    filter: (expr: FilterExpression<T>): FirestoreQueryFilterConstraint => {
      switch (expr.kind) {
        case 'where':
          return where(expr.fieldPath, expr.opStr, expr.value);
        case 'and':
          return and(...expr.filters.map(toFirestore.filter));
        case 'or':
          return or(...expr.filters.map(toFirestore.filter));
        default:
          return assertNever(expr);
      }
    },
  };

  const fromFirestore = {
    documentMustExist: (document: DocumentSnapshot): Doc<T> => {
      // biome-ignore lint/plugin/no-type-assertion: cannot infer type here
      const data = document.data() as DocData<T> | undefined;
      if (!data) {
        throw new Error('document must exist');
      }
      return { ...fromFirestore.docRef(document.ref), data };
    },
    document: (document: DocumentSnapshot): Doc<T> | undefined => {
      if (!document.exists()) {
        return undefined;
      }
      return fromFirestore.documentMustExist(document);
    },
    docRef: (ref: DocumentReference): DocRef<T> => {
      const parentCollection = ref.parent;
      // biome-ignore lint/plugin/no-type-assertion: cannot infer type here
      return (
        parentCollection.parent
          ? { id: ref.id, parent: fromFirestore.docRef(parentCollection.parent) }
          : { id: ref.id }
      ) as DocRef<T>;
    },
  };

  const batchWriteOperation = async <U>(
    targets: U[],
    runner: {
      batch: (batch: WriteBatch, target: U) => void;
      transaction: (transaction: Transaction, target: U) => void;
    },
    options?: WriteTransactionOption<Env>,
  ): Promise<void> => {
    const tx = options?.tx;
    if (tx) {
      if (tx instanceof Transaction) {
        targets.forEach((target) => void runner.transaction(tx, target));
      } else {
        targets.forEach((target) => void runner.batch(tx, target));
      }
    } else {
      const batch = writeBatch(db);
      targets.forEach((target) => void runner.batch(batch, target));
      await batch.commit();
    }
  };

  return { fromFirestore, toFirestore, batchWriteOperation };
};
