import type * as firestore from '@google-cloud/firestore';
import { AggregateField, Filter, Transaction } from '@google-cloud/firestore';
import type { Aggregated, AggregateSpec } from 'firestore-repository/aggregate';
import { collectionPath, documentPath } from 'firestore-repository/path';
import type { FilterExpression, Query } from 'firestore-repository/query';
import type {
  Repository,
  TransactionOption,
  Unsubscribe,
  WriteTransactionOption,
} from 'firestore-repository/repository';
import type { Collection, Doc, DocData, DocRef, DocToWrite } from 'firestore-repository/schema';
import { assertNever } from 'firestore-repository/util';

export type Env = {
  transaction: firestore.Transaction;
  writeBatch: firestore.WriteBatch;
  query: firestore.Query;
};

export interface GoogleCloudFirestoreRepository<T extends Collection> extends Repository<T, Env> {
  /**
   * Create a new document
   * @throws If the document already exists
   */
  create: (docToWrite: DocToWrite<T>, options?: WriteTransactionOption<Env>) => Promise<void>;
  /**
   * Create multiple documents
   * The entire operation will fail if one creation fails
   */
  batchCreate: (docs: DocToWrite<T>[], options?: WriteTransactionOption<Env>) => Promise<void>;
  /**
   * Get documents by multiple IDs
   * example: [{id:1}, {id:2}, {id:5}, {id:1}] -> [doc1, doc2, undefined, doc1]
   */
  batchGet: (
    refs: DocRef<T>[],
    options?: TransactionOption<Env>,
  ) => Promise<(Doc<T> | undefined)[]>;
}

export const newRepository = <T extends Collection>(
  collection: T,
  db: firestore.Firestore,
): GoogleCloudFirestoreRepository<T> => {
  const { toFirestore, fromFirestore, batchWriteOperation } = buildFirestoreUtilities(
    db,
    collection,
  );

  return {
    collection,

    get: async (ref: DocRef<T>, options?: TransactionOption<Env>): Promise<Doc<T> | undefined> => {
      const docRef = toFirestore.docRef(ref);
      const documentSnapshot = await (options?.tx ? options.tx.get(docRef) : docRef.get());
      return fromFirestore.document(documentSnapshot);
    },

    getOnSnapshot: (
      ref: DocRef<T>,
      next: (snapshot: Doc<T> | undefined) => void,
      error?: (error: Error) => void,
    ): Unsubscribe => {
      const docRef = toFirestore.docRef(ref);
      return docRef.onSnapshot((snapshot) => {
        next(fromFirestore.document(snapshot));
      }, error);
    },

    list: async (query: Query<T>): Promise<Doc<T>[]> => {
      const firestoreQuery = toFirestore.query(query);
      const { docs } = await firestoreQuery.get();
      return docs.map(fromFirestore.documentMustExist);
    },

    listOnSnapshot: (
      query: Query<T>,
      next: (snapshot: Doc<T>[]) => void,
      error?: (error: Error) => void,
    ): Unsubscribe => {
      const firestoreQuery = toFirestore.query(query);
      return firestoreQuery.onSnapshot((snapshot) => {
        next(snapshot.docs.map((doc) => fromFirestore.documentMustExist(doc)));
      }, error);
    },

    aggregate: async <U extends AggregateSpec<T>>(
      query: Query<T>,
      spec: U,
    ): Promise<Aggregated<U>> => {
      const aggregateSpec: firestore.AggregateSpec = {};
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

      const firestoreQuery = toFirestore.query(query);
      const res = await firestoreQuery.aggregate(aggregateSpec).get();
      // biome-ignore lint/plugin/no-type-assertion: there is no way to infer correct type
      return res.data() as Aggregated<U>;
    },

    create: async (
      docToWrite: DocToWrite<T>,
      options?: WriteTransactionOption<Env>,
    ): Promise<void> => {
      const docRef = toFirestore.docRef(docToWrite);
      await (options?.tx
        ? options.tx.create(docRef, docToWrite.data)
        : docRef.create(docToWrite.data));
    },

    set: async (
      docToWrite: DocToWrite<T>,
      options?: WriteTransactionOption<Env>,
    ): Promise<void> => {
      const docRef = toFirestore.docRef(docToWrite);
      await (options?.tx
        ? options.tx instanceof Transaction
          ? options.tx.set(docRef, docToWrite.data)
          : options.tx.set(docRef, docToWrite.data)
        : docRef.set(docToWrite.data));
    },

    delete: async (ref: DocRef<T>, options?: WriteTransactionOption<Env>): Promise<void> => {
      const docRef = toFirestore.docRef(ref);
      await (options?.tx ? options.tx.delete(docRef) : docRef.delete());
    },

    batchGet: async (
      refs: DocRef<T>[],
      options?: TransactionOption<Env>,
    ): Promise<(Doc<T> | undefined)[]> => {
      if (refs.length === 0) {
        return [];
      }
      const docRefs = refs.map((ref) => toFirestore.docRef(ref));
      const docs = await (options?.tx ? options.tx.getAll(...docRefs) : db.getAll(...docRefs));
      return docs.map((doc) => {
        return fromFirestore.document(doc);
      });
    },

    batchSet: async (
      docs: DocToWrite<T>[],
      options?: WriteTransactionOption<Env>,
    ): Promise<void> => {
      await batchWriteOperation(
        docs,
        {
          batch: (batch, doc) => batch.set(toFirestore.docRef(doc), doc.data),
          transaction: (tx, doc) => tx.set(toFirestore.docRef(doc), doc.data),
        },
        options,
      );
    },

    batchCreate: async (
      docs: DocToWrite<T>[],
      options?: WriteTransactionOption<Env>,
    ): Promise<void> => {
      await batchWriteOperation(
        docs,
        {
          batch: (batch, doc) => batch.create(toFirestore.docRef(doc), doc.data),
          transaction: (tx, doc) => tx.create(toFirestore.docRef(doc), doc.data),
        },
        options,
      );
    },

    batchDelete: async (
      refs: DocRef<T>[],
      options?: WriteTransactionOption<Env>,
    ): Promise<void> => {
      await batchWriteOperation(
        refs,
        {
          batch: (batch, ref) => batch.delete(toFirestore.docRef(ref)),
          transaction: (tx, ref) => tx.delete(toFirestore.docRef(ref)),
        },
        options,
      );
    },
  };
};

const buildFirestoreUtilities = <T extends Collection>(db: firestore.Firestore, collection: T) => {
  const toFirestore = {
    docRef: (ref: DocRef<T>): firestore.DocumentReference => db.doc(documentPath(collection, ref)),
    query: (query: Query<T>): firestore.Query => {
      let base: firestore.Query;
      if ('collection' in query.base) {
        base = query.base.group
          ? db.collectionGroup(query.base.collection.name)
          : db.collection(collectionPath(query.base.collection, query.base.parent));
      } else if ('extends' in query.base) {
        base = toFirestore.query(query.base.extends);
      } else {
        return assertNever(query.base);
      }
      return (
        query.constraints?.reduce((q, constraint) => {
          switch (constraint.kind) {
            case 'where':
            case 'or':
            case 'and':
              return q.where(toFirestore.filter(constraint));
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
    },
    filter: (expr: FilterExpression<T>): firestore.Filter => {
      switch (expr.kind) {
        case 'where':
          return Filter.where(expr.fieldPath, expr.opStr, expr.value);
        case 'and':
          return Filter.and(...expr.filters.map(toFirestore.filter));
        case 'or':
          return Filter.or(...expr.filters.map(toFirestore.filter));
        default:
          return assertNever(expr);
      }
    },
  };
  const fromFirestore = {
    documentMustExist: (document: firestore.DocumentSnapshot): Doc<T> => {
      // biome-ignore lint/plugin/no-type-assertion: cannot infer type here
      const data = document.data() as DocData<T> | undefined;
      if (!data) {
        throw new Error('document must exist');
      }
      return { ...fromFirestore.docRef(document.ref), data };
    },
    document: (document: firestore.DocumentSnapshot): Doc<T> | undefined => {
      if (!document.exists) {
        return undefined;
      }
      return fromFirestore.documentMustExist(document);
    },
    docRef: (ref: firestore.DocumentReference): DocRef<T> => {
      const collection = ref.parent;
      // biome-ignore lint/plugin/no-type-assertion: cannot infer type here
      return (
        collection.parent
          ? { id: ref.id, parent: fromFirestore.docRef(collection.parent) }
          : { id: ref.id }
      ) as DocRef<T>;
    },
  };
  const batchWriteOperation = async <U>(
    targets: U[],
    runner: {
      batch: (batch: firestore.WriteBatch, target: U) => void;
      transaction: (transaction: firestore.Transaction, target: U) => void;
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
      const batch = db.batch();
      targets.forEach((target) => void runner.batch(batch, target));
      await batch.commit();
    }
  };

  return { fromFirestore, toFirestore, batchWriteOperation };
};
