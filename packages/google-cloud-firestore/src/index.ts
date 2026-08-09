import type * as firestore from '@google-cloud/firestore';
import { AggregateField, Filter, Transaction } from '@google-cloud/firestore';
import type { Aggregated, AggregateSpec } from 'firestore-repository/aggregate';
import { collectionPath, documentPath } from 'firestore-repository/path';
import {
  type FilterExpression,
  type Query,
  queryCollection,
  type QuerySource,
  type ResolvedEndBound,
  type ResolvedStartBound,
} from 'firestore-repository/query';
import {
  type AppModel,
  Doc,
  DocumentDecodeError,
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
import type {
  Collection,
  DocumentSchema,
  RootCollection,
  SubCollection,
} from 'firestore-repository/schema';
import { assertNever } from 'firestore-repository/util';

import { dataDecoder, cursorValueEncoder, filterOperandEncoder, dataEncoder } from './codec.js';

/** Platform-specific environment types for Google Cloud Firestore */
export type Env = { transaction: firestore.Transaction; writeBatch: firestore.WriteBatch };

/** Extended repository interface for Google Cloud Firestore with additional methods (create, batchCreate, batchGet) */
export interface GoogleCloudFirestoreRepository<
  T extends Collection,
  Model extends AppModel,
> extends Repository<T, Model, Env> {
  /**
   * Creates a new document
   * @throws If the document already exists
   */
  create: (docToWrite: Model['write'], options?: WriteTransactionOption<Env>) => Promise<void>;
  /**
   * Creates multiple documents.
   * The entire operation fails if any creation fails.
   */
  batchCreate: (docs: Model['write'][], options?: WriteTransactionOption<Env>) => Promise<void>;
  /**
   * Gets multiple documents by their IDs.
   * @example [{id:1}, {id:2}, {id:5}, {id:1}] -> [doc1, doc2, undefined, doc1]
   */
  batchGet: (
    refs: Model['id'][],
    options?: TransactionOption<Env>,
  ) => Promise<(Model['read'] | undefined)[]>;
}

/** Creates a repository for a root collection using plain document types */
export const rootCollectionRepository = <T extends RootCollection>(
  db: firestore.Firestore,
  collection: T,
): Repository<T, RootCollectionPlainModel<T>, Env> =>
  repositoryWithMapper(db, collection, rootCollectionPlainMapper(collection));

/** Creates a repository for a subcollection using plain document types */
export const subcollectionRepository = <T extends SubCollection>(
  db: firestore.Firestore,
  collection: T,
): Repository<T, PlainModel<T>, Env> =>
  repositoryWithMapper(db, collection, plainMapper(collection));

/** Creates a repository with a custom mapper for transforming between Firestore documents and application models */
export const repositoryWithMapper = <T extends Collection, Model extends AppModel>(
  db: firestore.Firestore,
  collection: T,
  mapper: Mapper<T, Model>,
): GoogleCloudFirestoreRepository<T, Model> => {
  // oxlint-disable-next-line typescript/no-explicit-any -- Zod output is passed to Firestore SDK
  const encode = (data: unknown): any => encodeDocData(db, collection, data);

  return {
    collection,

    get: async (
      ref: Model['id'],
      options?: TransactionOption<Env>,
    ): Promise<Model['read'] | undefined> => {
      const docRef = toSdkDocRef(db, collection, mapper.toDocRef(ref));
      const documentSnapshot = await (options?.tx ? options.tx.get(docRef) : docRef.get());
      const doc = fromSdkDocument(collection, documentSnapshot);
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
      const docRef = toSdkDocRef(db, collection, mapper.toDocRef(ref));
      return docRef.onSnapshot((snapshot) => {
        const doc = fromSdkDocument(collection, snapshot);
        next(doc ? mapper.fromFirestore(doc) : undefined);
      }, error);
    },

    list: async (query: Query<T>): Promise<IteratorObject<Model['read']>> => {
      const firestoreQuery = toSdkQuery(db, query);
      const { docs } = await firestoreQuery.get();
      return docs
        .values()
        .map((doc) => mapper.fromFirestore(fromSdkDocumentMustExist(collection, doc)));
    },

    listOnSnapshot: (
      query: Query<T>,
      next: (snapshot: Model['read'][]) => void,
      error?: (error: Error) => void,
    ): Unsubscribe => {
      const firestoreQuery = toSdkQuery(db, query);
      return firestoreQuery.onSnapshot((snapshot) => {
        next(
          snapshot.docs.map((doc) =>
            mapper.fromFirestore(fromSdkDocumentMustExist(collection, doc)),
          ),
        );
      }, error);
    },

    aggregate: async <U extends AggregateSpec<T['schema']>>(
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

      const firestoreQuery = toSdkQuery(db, query);
      const res = await firestoreQuery.aggregate(aggregateSpec).get();
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- there is no way to infer correct type
      return res.data() as Aggregated<U>;
    },

    create: async (model: Model['write'], options?: WriteTransactionOption<Env>): Promise<void> => {
      const docToWrite = mapper.toFirestore(model);
      const docRef = toSdkDocRef(db, collection, docToWrite.id);
      const data = encode(docToWrite.data);
      await (options?.tx ? options.tx.create(docRef, data) : docRef.create(data));
    },

    set: async (model: Model['write'], options?: WriteTransactionOption<Env>): Promise<void> => {
      const docToWrite = mapper.toFirestore(model);
      const docRef = toSdkDocRef(db, collection, docToWrite.id);
      const data = encode(docToWrite.data);
      await (options?.tx
        ? options.tx instanceof Transaction
          ? options.tx.set(docRef, data)
          : options.tx.set(docRef, data)
        : docRef.set(data));
    },

    delete: async (ref: Model['id'], options?: WriteTransactionOption<Env>): Promise<void> => {
      const docRef = toSdkDocRef(db, collection, mapper.toDocRef(ref));
      await (options?.tx ? options.tx.delete(docRef) : docRef.delete());
    },

    batchGet: async (
      refs: Model['id'][],
      options?: TransactionOption<Env>,
    ): Promise<(Model['read'] | undefined)[]> => {
      if (refs.length === 0) {
        return [];
      }
      const docRefs = refs.map((ref) => toSdkDocRef(db, collection, mapper.toDocRef(ref)));
      const docs = await (options?.tx ? options.tx.getAll(...docRefs) : db.getAll(...docRefs));
      return docs.map((doc) => {
        const d = fromSdkDocument(collection, doc);
        return d ? mapper.fromFirestore(d) : undefined;
      });
    },

    batchSet: async (
      models: Model['write'][],
      options?: WriteTransactionOption<Env>,
    ): Promise<void> => {
      const docs = models.map((m) => {
        const d = mapper.toFirestore(m);
        return { id: d.id, data: encode(d.data) };
      });
      await batchWrite(
        db,
        docs,
        {
          batch: (batch, doc) => batch.set(toSdkDocRef(db, collection, doc.id), doc.data),
          transaction: (tx, doc) => tx.set(toSdkDocRef(db, collection, doc.id), doc.data),
        },
        options,
      );
    },

    batchCreate: async (
      models: Model['write'][],
      options?: WriteTransactionOption<Env>,
    ): Promise<void> => {
      const docs = models.map((m) => {
        const d = mapper.toFirestore(m);
        return { id: d.id, data: encode(d.data) };
      });
      await batchWrite(
        db,
        docs,
        {
          batch: (batch, doc) => batch.create(toSdkDocRef(db, collection, doc.id), doc.data),
          transaction: (tx, doc) => tx.create(toSdkDocRef(db, collection, doc.id), doc.data),
        },
        options,
      );
    },

    batchDelete: async (
      refs: Model['id'][],
      options?: WriteTransactionOption<Env>,
    ): Promise<void> => {
      const docRefs = refs.map(mapper.toDocRef);
      await batchWrite(
        db,
        docRefs,
        {
          batch: (batch, ref) => batch.delete(toSdkDocRef(db, collection, ref)),
          transaction: (tx, ref) => tx.delete(toSdkDocRef(db, collection, ref)),
        },
        options,
      );
    },
  };
};

/** Builds the SDK reference for a document address. */
export const toSdkDocRef = <T extends Collection>(
  db: firestore.Firestore,
  collection: T,
  ref: DocRef<T>,
): firestore.DocumentReference => db.doc(documentPath(collection, ...ref));

/**
 * Builds the `@google-cloud/firestore` query this library would run for `query`,
 * without running it.
 *
 * This is the escape hatch to SDK features the repository interface does not
 * wrap — `explain()` / `explainStream()` to inspect the query plan, `stream()`,
 * `findNearest()`, and whatever the SDK gains next. The returned query is an
 * ordinary SDK object, so its results are SDK snapshots, not this library's
 * models: decoding them back is the caller's job.
 */
export const toSdkQuery = <T extends Collection>(
  db: firestore.Firestore,
  query: Query<T>,
): firestore.Query => {
  const { schema } = queryCollection(query);
  let q = toSdkSource(db, query.source);
  for (const constraint of query.constraints) {
    switch (constraint.kind) {
      case 'where':
        q = q.where(toSdkFilter(db, schema, constraint.condition));
        break;
      case 'orderBy':
        q = q.orderBy(constraint.field, constraint.direction);
        break;
      case 'limit':
        q = q.limit(constraint.limit);
        break;
      case 'limitToLast':
        q = q.limitToLast(constraint.limit);
        break;
      case 'offset':
        q = q.offset(constraint.offset);
        break;
      default:
        return assertNever(constraint);
    }
  }
  // The bounds go last: the SDK only accepts a cursor once every clause it
  // pairs with is already on the query.
  if (query.start !== undefined) {
    q = toSdkBound(db, schema, q, query.start);
  }
  if (query.end !== undefined) {
    q = toSdkBound(db, schema, q, query.end);
  }
  return q;
};

const toSdkSource = <T extends Collection>(
  db: firestore.Firestore,
  source: QuerySource<T>,
): firestore.Query => {
  switch (source.kind) {
    case 'collection':
      return db.collection(collectionPath(source.collection, ...source.parent));
    case 'collectionGroup':
      return db.collectionGroup(source.collection.name);
    case 'query':
      return toSdkQuery(db, source);
    default:
      return assertNever(source);
  }
};

/**
 * Applies a bound, encoding each cursor value against the field it carries —
 * which field that is was settled when the query was built.
 */
const toSdkBound = <S extends DocumentSchema>(
  db: firestore.Firestore,
  schema: S,
  q: firestore.Query,
  bound: ResolvedStartBound<S> | ResolvedEndBound<S>,
): firestore.Query => {
  const encodeCursorValue = cursorValueEncoder(schema, db);
  const values = bound.cursor.map(({ value, field }) => encodeCursorValue(field, value));
  switch (bound.kind) {
    case 'startAt':
      return q.startAt(...values);
    case 'startAfter':
      return q.startAfter(...values);
    case 'endAt':
      return q.endAt(...values);
    case 'endBefore':
      return q.endBefore(...values);
    default:
      return assertNever(bound);
  }
};

const toSdkFilter = <S extends DocumentSchema>(
  db: firestore.Firestore,
  schema: S,
  expr: FilterExpression<S>,
): firestore.Filter => {
  switch (expr.kind) {
    case 'fieldValueCondition':
      return Filter.where(
        expr.fieldPath,
        expr.opStr,
        filterOperandEncoder(schema, db)(expr.fieldPath, expr.opStr, expr.value),
      );
    case 'and':
      return Filter.and(...expr.filters.map((f) => toSdkFilter(db, schema, f)));
    case 'or':
      return Filter.or(...expr.filters.map((f) => toSdkFilter(db, schema, f)));
    default:
      return assertNever(expr);
  }
};

/** Converts an SDK document reference into this library's address form. */
export const fromSdkDocRef = <T extends Collection>(
  ref: firestore.DocumentReference,
): DocRef<T> => {
  const docRef: string[] = [];

  let currentRef: firestore.DocumentReference | null = ref;
  while (currentRef != null) {
    docRef.push(currentRef.id);
    currentRef = currentRef.parent.parent;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- cannot infer type here
  return docRef.reverse() as DocRef<T>;
};

const fromSdkDocumentMustExist = <T extends Collection>(
  collection: T,
  document: firestore.DocumentSnapshot,
): Doc<T> => {
  const data = document.data();
  if (!data) {
    throw new Error(`document "${document.ref.path}" must exist`);
  }
  return {
    id: fromSdkDocRef(document.ref),
    data: decodeDocData(collection, data, document.ref.path),
  };
};

/** Decodes an SDK snapshot into this library's document, or undefined if absent. */
export const fromSdkDocument = <T extends Collection>(
  collection: T,
  document: firestore.DocumentSnapshot,
): Doc<T> | undefined => {
  if (!document.exists) {
    return undefined;
  }
  return fromSdkDocumentMustExist(collection, document);
};

/**
 * Decodes raw Firestore document data into the schema's read type, attributing
 * a validation failure to `documentPath` — the decoder itself only knows the
 * field path within the document.
 */
const decodeDocData = <T extends Collection>(
  collection: T,
  data: firestore.DocumentData,
  documentPath: string,
): DocData<T> => {
  try {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Zod output is typed by the schema, which the compiler cannot infer from the runtime schema value
    return dataDecoder(collection.schema).parse(data) as DocData<T>;
  } catch (e) {
    throw new DocumentDecodeError(documentPath, e);
  }
};

/** Encodes a document's data for the SDK, applying the schema's write conversions. */
const encodeDocData = <T extends Collection>(
  db: firestore.Firestore,
  collection: T,
  data: unknown,
): unknown => dataEncoder(collection.schema, db).parse(data);

const batchWrite = async <U>(
  db: firestore.Firestore,
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
