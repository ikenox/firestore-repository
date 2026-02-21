import type { Aggregated, AggregateSpec } from './aggregate.js';
import type {
  ArrayRemove,
  ArrayUnion,
  Bytes,
  DocumentReference,
  GeoPoint,
  Increment,
  ServerTimestamp,
  Timestamp,
  DeserializedDocumentReference,
  DeserializedGeoPoint,
  DeserializedVectorValue,
  VectorValue,
  WriteDocumentData,
} from './document.js';
import type { Query } from './query.js';
import type { Collection, Doc, DocData, DocRef, DocToWrite, RootCollection } from './schema.js';

/**
 * A universal repository interface
 */
export interface Repository<
  T extends Collection = Collection,
  Model extends AppModel = AppModel,
  Env extends FirestoreEnvironment = FirestoreEnvironment,
> {
  collection: T;

  /**
   * Gets a single document by ID
   */
  get: (ref: Model['id'], options?: TransactionOption<Env>) => Promise<Model['read'] | undefined>;

  /**
   * Listens to a single document for changes
   */
  getOnSnapshot: (
    ref: Model['id'],
    next: (snapshot: Model['read'] | undefined) => void,
    error?: (error: Error) => void,
  ) => Unsubscribe;

  /**
   * Returns documents matching the specified query
   */
  list: (query: Query<T>) => Promise<IteratorObject<Model['read']>>;

  /**
   * Listens to documents matching the specified query for changes
   */
  listOnSnapshot: (
    query: Query<T>,
    next: (snapshot: Model['read'][]) => void,
    error?: (error: Error) => void,
  ) => Unsubscribe;

  /**
   * Returns an aggregation result for the specified query
   */
  aggregate: <U extends AggregateSpec<T>>(query: Query<T>, spec: U) => Promise<Aggregated<U>>;

  /**
   * Creates or updates a document
   */
  set: (doc: Model['write'], options?: WriteTransactionOption<Env>) => Promise<void>;

  /**
   * Deletes a document by ID
   */
  delete: (ref: Model['id'], options?: WriteTransactionOption<Env>) => Promise<void>;

  /**
   * Creates or updates multiple documents
   */
  batchSet: (docs: Model['write'][], options?: WriteTransactionOption<Env>) => Promise<void>;

  /**
   * Deletes multiple documents by ID
   */
  batchDelete: (refs: Model['id'][], options?: WriteTransactionOption<Env>) => Promise<void>;
}

/** A mapper that converts between Firestore documents and application models */
export type Mapper<T extends Collection = Collection, Model extends AppModel = AppModel> = {
  toDocRef: (id: Model['id']) => DocRef<T>;
  fromFirestore: (doc: Doc<T>, deserializer: PlatformValueDeserializer) => Model['read'];
  toFirestore: (model: Model['write'], serializer: PlatformValueSerializer) => DocToWrite<T>;
};

/**
 * Converts platform-specific Firestore value types into plain JavaScript values.
 * Used when reading documents from Firestore to transform SDK types (Timestamp, Bytes, etc.)
 * into application-friendly types (Date, ArrayBuffer, etc.).
 */
export type PlatformValueDeserializer = {
  timestamp: (timestamp: Timestamp) => Date;
  bytes: (bytes: Bytes) => ArrayBuffer;
  documentReference: (docRef: DocumentReference) => DeserializedDocumentReference;
  geoPoint: (geoPoint: GeoPoint) => DeserializedGeoPoint;
  vectorValue: (vectorValue: VectorValue) => DeserializedVectorValue;
};

/**
 * Converts plain JavaScript values into platform-specific Firestore value types.
 * Used when writing documents to Firestore to transform application values into SDK types.
 * Also provides special write-only sentinel values (serverTimestamp, increment, etc.).
 */
export type PlatformValueSerializer = {
  timestamp: (date: Date) => Timestamp;
  bytes: (bytes: ArrayBuffer) => Bytes;
  documentReference: (docRef: DeserializedDocumentReference) => DocumentReference;
  geoPoint: (geoPoint: DeserializedGeoPoint) => GeoPoint;
  vectorValue: (vectorValue: DeserializedVectorValue) => VectorValue;
  serverTimestamp: () => ServerTimestamp;
  increment: (n: number) => Increment;
  arrayUnion: (...elements: unknown[]) => ArrayUnion;
  arrayRemove: (...elements: unknown[]) => ArrayRemove;
};

/** An application model type definition with id, read, and write shapes */
export type AppModel<Id = unknown, R = unknown, W extends R = R> = { id: Id; read: R; write: W };

/**
 * Platform-specific environment types for Firestore
 */
export type FirestoreEnvironment = { transaction: unknown; writeBatch: unknown };

/** Options for read operations within a transaction */
export type TransactionOption<T extends FirestoreEnvironment> = { tx?: T['transaction'] };
/** Options for write operations within a transaction or batch */
export type WriteTransactionOption<T extends FirestoreEnvironment> = {
  tx?: T['transaction'] | T['writeBatch'];
};
/** A function to unsubscribe from a snapshot listener */
export type Unsubscribe = () => void;

/** A repository that uses plain document types without custom mapping */
export type PlainRepository<
  T extends Collection = Collection,
  Env extends FirestoreEnvironment = FirestoreEnvironment,
> = Repository<T, PlainModel<T>, Env>;

/** A model that directly uses Doc and DocRef without custom mapping */
export type PlainModel<T extends Collection> = {
  id: DocRef<T>;
  write: DocToWrite<T>;
  read: Doc<T>;
};

/** A plain model for root collections where the id is a single string */
export type RootCollectionPlainModel<T extends Collection> = {
  id: string;
  write: { ref: string; data: DocData<T> | WriteDocumentData<DocData<T>> };
  read: { ref: string; data: DocData<T> };
};

/** Creates a plain mapper that passes documents through without transformation */
export const plainMapper = <T extends Collection>(_collection: T): Mapper<T, PlainModel<T>> => ({
  toDocRef: (id) => id,
  fromFirestore: (doc) => doc,
  toFirestore: (model) => model,
});

/** Creates a plain mapper for root collections where the id is a single string */
export const rootCollectionPlainMapper = <T extends RootCollection>(
  _collection: T,
): Mapper<T, RootCollectionPlainModel<T>> => ({
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- type system doesn't expand DocRef<T> into [string]
  toDocRef: (id) => [id] as unknown as DocRef<T>,
  fromFirestore: (doc) => ({ ref: doc.ref[0], data: doc.data }),
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- type system doesn't expand DocRef<T> into [string]
  toFirestore: (model) => ({ ref: [model.ref] as unknown as DocRef<T>, data: model.data }),
});
