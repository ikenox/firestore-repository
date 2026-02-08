import type * as firestore from '@google-cloud/firestore';
import { AggregateField, Filter, Transaction } from '@google-cloud/firestore';
import type { Aggregated, AggregateSpec } from 'firestore-repository/aggregate';
import { collectionPath, documentPath } from 'firestore-repository/path';
import type { FilterExpression, Query } from 'firestore-repository/query';
import {
  type AppModel,
  type Mapper,
  type PlainModel,
  plainMapper,
  type Repository,
  type RootCollectionPlainModel,
  rootCollectionPlainMapper,
  type TransactionOption,
  type Unsubscribe,
  type WriteTransactionOption,
} from 'firestore-repository/repository';
import type {
  Collection,
  Doc,
  DocData,
  DocRef,
  RootCollection,
  SubCollection,
} from 'firestore-repository/schema';
import { assertNever } from 'firestore-repository/util';

export type Env = {
  transaction: firestore.Transaction;
  writeBatch: firestore.WriteBatch;
  query: firestore.Query;
};

export interface GoogleCloudFirestoreRepository<T extends Collection, Model extends AppModel>
  extends Repository<T, Model, Env> {
  /**
   * Create a new document
   * @throws If the document already exists
   */
  create: (docToWrite: Model['write'], options?: WriteTransactionOption<Env>) => Promise<void>;
  /**
   * Create multiple documents
   * The entire operation will fail if one creation fails
   */
  batchCreate: (docs: Model['write'][], options?: WriteTransactionOption<Env>) => Promise<void>;
  /**
   * Get documents by multiple IDs
   * example: [{id:1}, {id:2}, {id:5}, {id:1}] -> [doc1, doc2, undefined, doc1]
   */
  batchGet: (
    refs: Model['id'][],
    options?: TransactionOption<Env>,
  ) => Promise<(Model['read'] | undefined)[]>;
}

export const newRootCollectionRepository = <T extends RootCollection>(
  db: firestore.Firestore,
  collection: T,
): Repository<T, RootCollectionPlainModel<T>, Env> =>
  newRepositoryWithMapper(db, collection, rootCollectionPlainMapper(collection));

export const newSubcollectionRepository = <T extends SubCollection>(
  db: firestore.Firestore,
  collection: T,
): Repository<T, PlainModel<T>, Env> =>
  newRepositoryWithMapper(db, collection, plainMapper(collection));

export const newRepositoryWithMapper = <T extends Collection, Model extends AppModel>(
  db: firestore.Firestore,
  collection: T,
  mapper: Mapper<T, Model>,
): GoogleCloudFirestoreRepository<T, Model> => {
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
      const documentSnapshot = await (options?.tx ? options.tx.get(docRef) : docRef.get());
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
      return docRef.onSnapshot((snapshot) => {
        const doc = fromFirestore.document(snapshot);
        next(doc ? mapper.fromFirestore(doc) : undefined);
      }, error);
    },

    list: async (query: Query<T>): Promise<Model['read'][]> => {
      const firestoreQuery = toFirestore.query(query);
      const { docs } = await firestoreQuery.get();
      return docs.map((doc) => mapper.fromFirestore(fromFirestore.documentMustExist(doc)));
    },

    listOnSnapshot: (
      query: Query<T>,
      next: (snapshot: Model['read'][]) => void,
      error?: (error: Error) => void,
    ): Unsubscribe => {
      const firestoreQuery = toFirestore.query(query);
      return firestoreQuery.onSnapshot((snapshot) => {
        next(
          snapshot.docs.map((doc) => mapper.fromFirestore(fromFirestore.documentMustExist(doc))),
        );
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

    create: async (model: Model['write'], options?: WriteTransactionOption<Env>): Promise<void> => {
      const docToWrite = mapper.toFirestore(model);
      const docRef = toFirestore.docRef(docToWrite.ref);
      await (options?.tx
        ? options.tx.create(docRef, docToWrite.data)
        : docRef.create(docToWrite.data));
    },

    set: async (model: Model['write'], options?: WriteTransactionOption<Env>): Promise<void> => {
      const docToWrite = mapper.toFirestore(model);
      const docRef = toFirestore.docRef(docToWrite.ref);
      await (options?.tx
        ? options.tx instanceof Transaction
          ? options.tx.set(docRef, docToWrite.data)
          : options.tx.set(docRef, docToWrite.data)
        : docRef.set(docToWrite.data));
    },

    delete: async (ref: Model['id'], options?: WriteTransactionOption<Env>): Promise<void> => {
      const docRef = toFirestore.docRef(mapper.toDocRef(ref));
      await (options?.tx ? options.tx.delete(docRef) : docRef.delete());
    },

    batchGet: async (
      refs: Model['id'][],
      options?: TransactionOption<Env>,
    ): Promise<(Model['read'] | undefined)[]> => {
      if (refs.length === 0) {
        return [];
      }
      const docRefs = refs.map((ref) => toFirestore.docRef(mapper.toDocRef(ref)));
      const docs = await (options?.tx ? options.tx.getAll(...docRefs) : db.getAll(...docRefs));
      return docs.map((doc) => {
        const d = fromFirestore.document(doc);
        return d ? mapper.fromFirestore(d) : undefined;
      });
    },

    batchSet: async (
      models: Model['write'][],
      options?: WriteTransactionOption<Env>,
    ): Promise<void> => {
      const docs = models.map(mapper.toFirestore);
      await batchWriteOperation(
        docs,
        {
          batch: (batch, doc) => batch.set(toFirestore.docRef(doc.ref), doc.data),
          transaction: (tx, doc) => tx.set(toFirestore.docRef(doc.ref), doc.data),
        },
        options,
      );
    },

    batchCreate: async (
      models: Model['write'][],
      options?: WriteTransactionOption<Env>,
    ): Promise<void> => {
      const docs = models.map(mapper.toFirestore);
      await batchWriteOperation(
        docs,
        {
          batch: (batch, doc) => batch.create(toFirestore.docRef(doc.ref), doc.data),
          transaction: (tx, doc) => tx.create(toFirestore.docRef(doc.ref), doc.data),
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
      return { ref: fromFirestore.docRef(document.ref), data };
    },
    document: (document: firestore.DocumentSnapshot): Doc<T> | undefined => {
      if (!document.exists) {
        return undefined;
      }
      return fromFirestore.documentMustExist(document);
    },
    docRef: (ref: firestore.DocumentReference): DocRef<T> => {
      const docRef: string[] = [];

      let currentRef: firestore.DocumentReference | null = ref;
      while (currentRef != null) {
        docRef.push(currentRef.id);
        currentRef = currentRef.parent.parent;
      }
      // biome-ignore lint/plugin/no-type-assertion: cannot infer type here
      return docRef.reverse() as DocRef<T>;
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
