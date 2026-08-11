import type {
  AggregateSpec as FirestoreAggregateSpec,
  DocumentData,
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
import {
  type FilterExpression,
  type Query,
  queryCollection,
  queryScope,
  type QueryScope,
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
import {
  type Collection,
  type DocumentSchema,
  type RootCollection,
  type SubCollection,
} from 'firestore-repository/schema';
import { assertNever } from 'firestore-repository/util';

import { dataDecoder, cursorValueEncoder, filterOperandEncoder, dataEncoder } from './codec.js';

/** Platform-specific environment types for Firebase JS SDK */
export type Env = { transaction: Transaction; writeBatch: WriteBatch };

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
  // oxlint-disable-next-line typescript/no-explicit-any -- Zod output is passed to Firestore SDK
  const encode = (data: unknown): any => encodeDocData(db, collection, data);

  return {
    collection,

    get: async (
      ref: Model['id'],
      options?: TransactionOption<Env>,
    ): Promise<Model['read'] | undefined> => {
      const docRef = toSdkDocRef(db, collection, mapper.toDocRef(ref));
      const documentSnapshot = await (options?.tx ? options.tx.get(docRef) : getDoc(docRef));
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
      return onSnapshot(docRef, {
        next: (snapshot) => {
          const doc = fromSdkDocument(collection, snapshot);
          next(doc ? mapper.fromFirestore(doc) : undefined);
        },
        error: (e) => error?.(e),
      });
    },

    list: async (query: Query<T>): Promise<IteratorObject<Model['read']>> => {
      const firestoreQueryObj = toSdkQuery(db, query);
      const { docs } = await getDocs(firestoreQueryObj);
      return docs
        .values()
        .map((doc) => mapper.fromFirestore(fromSdkDocumentMustExist(collection, doc)));
    },

    listOnSnapshot: (
      query: Query<T>,
      next: (snapshot: Model['read'][]) => void,
      error?: (error: Error) => void,
    ): Unsubscribe => {
      const firestoreQueryObj = toSdkQuery(db, query);
      return onSnapshot(firestoreQueryObj, {
        next: ({ docs }) =>
          next(docs.map((doc) => mapper.fromFirestore(fromSdkDocumentMustExist(collection, doc)))),
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

      const firestoreQueryObj = toSdkQuery(db, query);
      const res = await getAggregateFromServer(firestoreQueryObj, aggregateSpec);
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- there is no way to infer correct type
      return res.data() as Aggregated<U>;
    },

    set: async (model: Model['write'], options?: WriteTransactionOption<Env>): Promise<void> => {
      const docToWrite = mapper.toFirestore(model);
      const docRef = toSdkDocRef(db, collection, docToWrite.id);
      const data = encode(docToWrite.data);
      await (options?.tx
        ? options.tx instanceof Transaction
          ? options.tx.set(docRef, data)
          : options.tx.set(docRef, data)
        : setDoc(docRef, data));
    },

    delete: async (ref: Model['id'], options?: WriteTransactionOption<Env>): Promise<void> => {
      const docRef = toSdkDocRef(db, collection, mapper.toDocRef(ref));
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
      await batchWrite(
        db,
        docs,
        {
          batch: (batch, d) => batch.set(toSdkDocRef(db, collection, d.id), d.data),
          transaction: (tx, d) => tx.set(toSdkDocRef(db, collection, d.id), d.data),
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
  db: Firestore,
  coll: T,
  ref: DocRef<T>,
): FirestoreDocumentReference => doc(db, documentPath(coll, ...ref));

/**
 * Builds the `@firebase/firestore` query this library would run for `query`,
 * without running it.
 *
 * This is the escape hatch to SDK features the repository interface does not
 * wrap, and to ones this library cannot express — `getDocsFromCache()`,
 * `getCountFromServer()`, and whatever the SDK gains next. The returned query is
 * an ordinary SDK object, so its results are SDK snapshots, not this library's
 * models: decoding them back is the caller's job.
 */
export const toSdkQuery = <T extends Collection>(
  db: Firestore,
  query: Query<T>,
): FirestoreQuery => {
  const { schema } = queryCollection(query);
  const base = toSdkSource(db, query.source);

  const { filter, nonFilter } = query.constraints.reduce<{
    filter?: FirestoreQueryFilterConstraint;
    nonFilter: QueryNonFilterConstraint[];
  }>(
    (acc, constraint) => {
      switch (constraint.kind) {
        case 'where': {
          const f = toSdkFilter(db, schema, constraint.condition);
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
        default:
          return assertNever(constraint);
      }
      return acc;
    },
    { nonFilter: [] },
  );

  // The bounds go last: the SDK only accepts a cursor once every clause it
  // pairs with is already on the query.
  // The document key's cursor form depends on what the query reads, so the
  // scope travels with the bound — see this package's `encodeKeyCursor`.
  const scope = queryScope(query.source);
  if (query.start !== undefined) {
    nonFilter.push(toSdkBound(db, schema, query.start, scope));
  }
  if (query.end !== undefined) {
    nonFilter.push(toSdkBound(db, schema, query.end, scope));
  }

  // Wrap single filter in and() to satisfy QueryCompositeFilterConstraint overload
  return filter
    ? firestoreQuery(base, and(filter), ...nonFilter)
    : firestoreQuery(base, ...nonFilter);
};

const toSdkSource = <T extends Collection>(
  db: Firestore,
  source: QuerySource<T>,
): FirestoreQuery => {
  switch (source.kind) {
    case 'collection':
      return collection(db, collectionPath(source.collection, ...source.parent));
    case 'collectionGroup':
      return collectionGroup(db, source.collection.name);
    case 'query':
      return toSdkQuery(db, source);
    default:
      return assertNever(source);
  }
};

/**
 * Builds a bound constraint, encoding each cursor value against the field it
 * carries — which field that is was settled when the query was built.
 */
const toSdkBound = <S extends DocumentSchema>(
  db: Firestore,
  schema: S,
  bound: ResolvedStartBound<S> | ResolvedEndBound<S>,
  scope: QueryScope,
): QueryNonFilterConstraint => {
  const encodeCursorValue = cursorValueEncoder(schema, db);
  const values = bound.cursor.map(({ value, field }) => encodeCursorValue(field, value, scope));
  switch (bound.kind) {
    case 'startAt':
      return startAt(...values);
    case 'startAfter':
      return startAfter(...values);
    case 'endAt':
      return endAt(...values);
    case 'endBefore':
      return endBefore(...values);
    default:
      return assertNever(bound);
  }
};

const toSdkFilter = <S extends DocumentSchema>(
  db: Firestore,
  schema: S,
  expr: FilterExpression<S>,
): FirestoreQueryFilterConstraint => {
  switch (expr.kind) {
    case 'fieldValueCondition':
      return where(
        expr.fieldPath,
        expr.opStr,
        filterOperandEncoder(schema, db)(expr.fieldPath, expr.opStr, expr.value),
      );
    case 'and':
      return and(...expr.filters.map((f) => toSdkFilter(db, schema, f)));
    case 'or':
      return or(...expr.filters.map((f) => toSdkFilter(db, schema, f)));
    default:
      return assertNever(expr);
  }
};

/** Converts an SDK document reference into this library's address form. */
export const fromSdkDocRef = <T extends Collection>(ref: FirestoreDocumentReference): DocRef<T> => {
  const docRef: string[] = [];

  let currentRef: FirestoreDocumentReference | null = ref;
  while (currentRef != null) {
    docRef.push(currentRef.id);
    currentRef = currentRef.parent.parent;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- cannot infer type here
  return docRef.reverse() as DocRef<T>;
};

const fromSdkDocumentMustExist = <T extends Collection>(
  coll: T,
  document: DocumentSnapshot,
): Doc<T> => {
  const data = document.data();
  if (!data) {
    throw new Error(`document "${document.ref.path}" must exist`);
  }
  return { id: fromSdkDocRef(document.ref), data: decodeDocData(coll, data, document.ref.path) };
};

/** Decodes an SDK snapshot into this library's document, or undefined if absent. */
export const fromSdkDocument = <T extends Collection>(
  coll: T,
  document: DocumentSnapshot,
): Doc<T> | undefined => {
  if (!document.exists()) {
    return undefined;
  }
  return fromSdkDocumentMustExist(coll, document);
};

/**
 * Decodes raw Firestore document data into the schema's read type, attributing
 * a validation failure to `documentPath` — the decoder itself only knows the
 * field path within the document.
 */
const decodeDocData = <T extends Collection>(
  coll: T,
  data: DocumentData,
  documentPath: string,
): DocData<T> => {
  try {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Zod output is typed by the schema, which the compiler cannot infer from the runtime schema value
    return dataDecoder(coll.schema).parse(data) as DocData<T>;
  } catch (e) {
    throw new DocumentDecodeError(documentPath, e);
  }
};

/** Encodes a document's data for the SDK, applying the schema's write conversions. */
const encodeDocData = <T extends Collection>(db: Firestore, coll: T, data: unknown): unknown =>
  dataEncoder(coll.schema, db).parse(data);

const batchWrite = async <U>(
  db: Firestore,
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
