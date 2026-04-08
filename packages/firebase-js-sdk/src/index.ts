import type {
  AggregateSpec as FirestoreAggregateSpec,
  DocumentSnapshot,
  Firestore,
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
  DocumentReference as FirestoreDocumentReference,
  endAt,
  endBefore,
  getAggregateFromServer,
  getDoc,
  getDocs,
  limit,
  limitToLast,
  onSnapshot,
  or,
  orderBy,
  query as firestoreQuery,
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
  Doc,
  DocData,
  DocRef,
  type Mapper,
  plainMapper,
  type PlainModel,
  type Repository,
  rootCollectionPlainMapper,
  type RootCollectionPlainModel,
  type TransactionOption,
  type Unsubscribe,
  type WriteTransactionOption,
} from 'firestore-repository/repository';
import type { Collection, RootCollection, SubCollection } from 'firestore-repository/schema';
import { assertNever } from 'firestore-repository/util';

import { buildDecodeSchema, buildEncodeSchema } from './codec.js';

/** Platform-specific environment types for Firebase JS SDK */
export type Env = { transaction: Transaction; writeBatch: WriteBatch; query: FirestoreQuery };

/** Creates a repository for a root collection using plain document types */
export const rootCollectionRepository = <T extends RootCollection>(
  db: Firestore,
  collection: T,
): Repository<T, RootCollectionPlainModel<T>, Env> =>
  repositoryWithMapper(db, collection, rootCollectionPlainMapper(collection));

/** Creates a repository for a subcollection using plain document types */
export const subcollectionRepository = <T extends SubCollection>(
  db: Firestore,
  collection: T,
): Repository<T, PlainModel<T>, Env> =>
  repositoryWithMapper(db, collection, plainMapper(collection));

/** Creates a repository with a custom mapper for transforming between Firestore documents and application models */
export const repositoryWithMapper = <T extends Collection, Model extends AppModel>(
  db: Firestore,
  collection: T,
  mapper: Mapper<T, Model>,
): Repository<T, Model, Env> => {
  const { toFirestore, fromFirestore, batchWriteOperation, encodeSchema } = buildFirestoreUtilities(
    db,
    collection,
  );
  // oxlint-disable-next-line typescript/no-explicit-any -- Zod output is passed to Firestore SDK
  const encode = (data: unknown): any => encodeSchema.parse(data);

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

    list: async (query: Query<T>): Promise<IteratorObject<Model['read']>> => {
      const firestoreQueryObj = toFirestore.query(query);
      const { docs } = await getDocs(firestoreQueryObj);
      return docs.values().map((doc) => mapper.fromFirestore(fromFirestore.documentMustExist(doc)));
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

    aggregate: async <U extends AggregateSpec<T['schema']>>(
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
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- there is no way to infer correct type
      return res.data() as Aggregated<U>;
    },

    set: async (model: Model['write'], options?: WriteTransactionOption<Env>): Promise<void> => {
      const docToWrite = mapper.toFirestore(model);
      const docRef = toFirestore.docRef(docToWrite.id);
      const data = encode(docToWrite.data);
      await (options?.tx
        ? options.tx instanceof Transaction
          ? options.tx.set(docRef, data)
          : options.tx.set(docRef, data)
        : setDoc(docRef, data));
    },

    delete: async (ref: Model['id'], options?: WriteTransactionOption<Env>): Promise<void> => {
      const docRef = toFirestore.docRef(mapper.toDocRef(ref));
      await (options?.tx ? options.tx.delete(docRef) : deleteDoc(docRef));
    },

    batchSet: async (
      models: Model['write'][],
      options?: WriteTransactionOption<Env>,
    ): Promise<void> => {
      const docs = models.map((m) => {
        const d = mapper.toFirestore(m);
        return { id: d.id, data: encode(d.data) };
      });
      await batchWriteOperation(
        docs,
        {
          batch: (batch, d) => batch.set(toFirestore.docRef(d.id), d.data),
          transaction: (tx, d) => tx.set(toFirestore.docRef(d.id), d.data),
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
  const decodeSchema = buildDecodeSchema(coll.schema);
  const encodeSchema = buildEncodeSchema(coll.schema, db);

  const toFirestore = {
    docRef: (ref: DocRef<T>): FirestoreDocumentReference => doc(db, documentPath(coll, ref)),
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
            case 'where': {
              const f = toFirestore.filter(constraint.condition);
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
    filter: (expr: FilterExpression<T['schema']>): FirestoreQueryFilterConstraint => {
      switch (expr.kind) {
        case 'fieldValueCondition':
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
    documentMustExist: (document: DocumentSnapshot): Doc<T, 'read'> => {
      const data = document.data();
      if (!data) {
        throw new Error('document must exist');
      }
      return {
        id: fromFirestore.docRef(document.ref),
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Zod output is typed by schema
        data: decodeSchema.parse(data) as DocData<T['schema'], 'read'>,
      };
    },
    document: (document: DocumentSnapshot): Doc<T, 'read'> | undefined => {
      if (!document.exists()) {
        return undefined;
      }
      return fromFirestore.documentMustExist(document);
    },
    docRef: (ref: FirestoreDocumentReference): DocRef<T> => {
      const docRef: string[] = [];

      let currentRef: FirestoreDocumentReference | null = ref;
      while (currentRef != null) {
        docRef.push(currentRef.id);
        currentRef = currentRef.parent.parent;
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- cannot infer type here
      return docRef.reverse() as DocRef<T>;
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

  return { fromFirestore, toFirestore, batchWriteOperation, encodeSchema };
};
