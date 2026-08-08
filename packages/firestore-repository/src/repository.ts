import type { Aggregated, AggregateSpec } from './aggregate.js';
import type { Query } from './query.js';
import { Collection, FieldValue, MapType, RootCollection } from './schema.js';
import type { ToStringTuple } from './util.js';

/**
 * A universal repository interface.
 *
 * Every read path fails with a {@link DocumentDecodeError} when a stored
 * document does not match the collection's schema.
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
   * Listens to a single document for changes.
   *
   * `error` receives BOTH a stream failure and a document that does not decode
   * against the schema, and either ENDS the subscription — see
   * {@link subscribeDecoded} for what that costs and why. With no `error`
   * handler the failure is rethrown asynchronously rather than dropped.
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
   * Listens to documents matching the specified query for changes.
   *
   * A single document that does not decode fails the whole snapshot — there is
   * no partial delivery — and is reported on `error` exactly like a stream
   * failure; see {@link getOnSnapshot} for the shared error contract.
   */
  listOnSnapshot: (
    query: Query<T>,
    next: (snapshot: Model['read'][]) => void,
    error?: (error: Error) => void,
  ) => Unsubscribe;

  /**
   * Returns an aggregation result for the specified query
   */
  aggregate: <U extends AggregateSpec<T['schema']>>(
    query: Query<T>,
    spec: U,
  ) => Promise<Aggregated<U>>;

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
  fromFirestore: (doc: Doc<T>) => Model['read'];
  toFirestore: (model: Model['write']) => Doc<T, 'write'>;
};

/**
 * The three types a repository is parameterized by: the model's id, the value
 * a read produces (`R`), and the value a write accepts (`W`, defaulting to `R`
 * when the two are the same).
 *
 * The two value types are deliberately left UNRELATED by constraint, because
 * both directions occur. The plain models make the write type the WIDER one —
 * `Doc<T, 'write'>` also accepts `ServerTimestamp` / `Increment` where `Doc<T>`
 * reads a `Date` / `number` — while a custom model narrows it the other way to
 * drop server-managed fields from what a caller has to supply. A constraint in
 * either direction rejects one of those, and neither {@link Mapper} nor
 * {@link Repository} needs the relation: both are generic over all three.
 *
 * What does depend on a relation is reading a document and writing it back
 * (`repository.set(await repository.get(id))`), which needs `R` assignable to
 * `W`. That is a property of a particular model, so it is checked at the call
 * site that relies on it rather than declared here — the plain models satisfy
 * it, pinned in `repository.test.ts`.
 */
export type AppModel<Id = unknown, R = unknown, W = R> = { id: Id; read: R; write: W };

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

/**
 * A stored document that does not match its collection's schema.
 *
 * The validation failure itself is the `cause`; this type exists to add the
 * one thing that failure cannot know — WHICH document it was. A validation
 * error names a field path *within* a document (`age`), which is unactionable
 * on its own: schemas evolve and Firestore has no migrations, so the question
 * a caller actually has is which stored document to go and look at.
 *
 * It is thrown per document, so it identifies the document that failed even
 * when the read covered many.
 */
export class DocumentDecodeError extends Error {
  override readonly name = 'DocumentDecodeError';

  constructor(
    /** The document's path relative to the database root, e.g. `Authors/a1`. */
    readonly documentPath: string,
    cause: unknown,
  ) {
    super(`failed to decode document "${documentPath}"`, { cause });
  }
}

/** A repository that uses plain document types without custom mapping */
export type PlainRepository<
  T extends Collection = Collection,
  Env extends FirestoreEnvironment = FirestoreEnvironment,
> = Repository<T, PlainModel<T>, Env>;

/** A model that directly uses Doc and DocRef without custom mapping */
export type PlainModel<T extends Collection> = {
  id: DocRef<T>;
  write: Doc<T, 'write'>;
  read: Doc<T>;
};

/** A plain model for root collections where the id is a single string */
export type RootCollectionPlainModel<T extends Collection> = {
  id: string;
  write: { id: string; data: DocData<T, 'write'> };
  read: { id: string; data: DocData<T> };
};

/** A Firestore document */
export type Doc<T extends Collection, Mode extends 'read' | 'write' = 'read'> = {
  id: DocRef<T>;
  data: DocData<T, Mode>;
};

/** A document reference represented as a tuple of document IDs */
export type DocRef<T extends Collection> = [...ParentDocRef<T>, string];

/** A parent document reference of a subcollection */
export type ParentDocRef<T extends Collection> = ToStringTuple<T['parent']>;

/** The resolved TypeScript type of the document's data, derived from a schema. In write mode, fields additionally accept server-side operations (e.g. ServerTimestamp, Increment). */
export type DocData<
  T extends Collection = Collection,
  Mode extends 'read' | 'write' = 'read',
> = FieldValue<MapType<T['schema']>, Mode>;

/**
 * Subscribes to a snapshot stream whose payload has to be DECODED before the
 * consumer sees it, keeping every failure on the ONE channel a caller watches.
 *
 * Decoding cannot be left where the SDK would run it: an exception thrown
 * inside the SDK's own next-handler escapes through its watch stream as an
 * uncaught exception, reaching neither {@link next} nor {@link error}. So it
 * runs here, guarded, and a failure takes the same path a stream failure does.
 *
 * Two consequences to know as a caller:
 *
 * - **A failure ENDS the subscription.** The SDKs close the stream before
 *   invoking their error callback, so `error` already means "this subscription
 *   is over"; a decode failure unsubscribes first so it keeps meaning exactly
 *   that — and a document that stays undecodable cannot then raise an error on
 *   every snapshot. Recovering means subscribing again.
 * - **With no `error` handler the failure is rethrown**, asynchronously and
 *   outside the SDK's stream, rather than logged or dropped: nothing about a
 *   document that will not decode should be invisible, and this package writes
 *   nothing to the console. (The admin SDK's own fallback for a missing handler
 *   IS `console.error`; the divergence is deliberate.)
 *
 * {@link next} is invoked OUTSIDE the guarded region — an exception from the
 * consumer's own handler is not a stream failure and must not be reported as
 * one.
 */
export const subscribeDecoded = <Snapshot, Model>(
  subscribe: (next: (snapshot: Snapshot) => void, error: (error: Error) => void) => Unsubscribe,
  decode: (snapshot: Snapshot) => Model,
  next: (model: Model) => void,
  error?: (error: Error) => void,
): Unsubscribe => {
  let unsubscribe: Unsubscribe | undefined;
  let ended = false;

  const end = (): void => {
    ended = true;
    unsubscribe?.();
  };

  const fail = (e: Error): void => {
    end();
    if (error) {
      error(e);
      return;
    }
    queueMicrotask(() => {
      throw e;
    });
  };

  unsubscribe = subscribe((snapshot) => {
    if (ended) {
      return;
    }
    let model: Model;
    try {
      model = decode(snapshot);
    } catch (e) {
      fail(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    next(model);
  }, fail);

  if (ended) {
    // A failure landed before `subscribe` returned, so `end()` had no
    // unsubscribe to call — release the subscription now.
    unsubscribe();
  }
  return end;
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
  fromFirestore: (doc) => ({ id: doc.id[0], data: doc.data }),
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- type system doesn't expand DocRef<T> into [string]
  toFirestore: (model) => ({ id: [model.id] as unknown as DocRef<T>, data: model.data }),
});
