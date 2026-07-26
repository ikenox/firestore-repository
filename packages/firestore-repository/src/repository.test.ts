import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  AppModel,
  Doc,
  DocRef,
  DocumentDecodeError,
  Mapper,
  subscribeDecoded,
  type Unsubscribe,
} from './repository.js';
import {
  Collection,
  rootCollection,
  ServerTimestamp,
  string,
  subCollection,
  timestamp,
} from './schema.js';
import { serverTimestamp } from './server-value.js';

describe('repository', () => {
  const authorsCollection = rootCollection({
    name: 'Authors',
    schema: { name: string(), registeredAt: timestamp() },
  });

  const postsCollection = subCollection({
    name: 'Posts',
    schema: { title: string(), postedAt: timestamp() },
    parent: ['Authors'],
  });

  const commentsCollection = subCollection({
    name: 'Comments',
    schema: { content: string(), commentedAt: timestamp() },
    parent: ['Authors', 'Posts'],
  });

  type AuthorsCollection = typeof authorsCollection;
  type PostsCollection = typeof postsCollection;
  type CommentsCollection = typeof commentsCollection;

  it('Doc', () => {
    expectTypeOf<Doc<AuthorsCollection>>().toEqualTypeOf<{
      id: [string];
      data: { name: string; registeredAt: Date };
    }>();
    expectTypeOf<Doc<AuthorsCollection, 'write'>>().toEqualTypeOf<{
      id: [string];
      data: { name: string; registeredAt: Date | ServerTimestamp };
    }>();

    // read model type should be always compatible to write model
    expectTypeOf<Doc<AuthorsCollection>>().toExtend<Doc<AuthorsCollection, 'write'>>();
    expectTypeOf<Doc<PostsCollection>>().toExtend<Doc<PostsCollection, 'write'>>();
    expectTypeOf<Doc<CommentsCollection>>().toExtend<Doc<CommentsCollection, 'write'>>();

    // TODO: this assertion should be passed
    (<T extends Collection>() => {
      // @ts-expect-error -- TODO: this assertion should be passed once generic constraint is resolved
      expectTypeOf<Doc<T>>().toExtend<Doc<T, 'write'>>();
    })();
  });

  // Both directions of the read/write relation are legitimate models, so
  // `AppModel` constrains neither — see its JSDoc. Each row here is a shape
  // that must stay expressible.
  it('AppModel admits a write type on either side of the read type', () => {
    type User = { id: string; name: string; createdAt: Date };

    // Wider write: what the plain models are — a write also accepts the server
    // operations that a read never produces.
    expectTypeOf<
      AppModel<DocRef<AuthorsCollection>, Doc<AuthorsCollection>, Doc<AuthorsCollection, 'write'>>
    >().toEqualTypeOf<{
      id: DocRef<AuthorsCollection>;
      read: Doc<AuthorsCollection>;
      write: Doc<AuthorsCollection, 'write'>;
    }>();

    // Narrower write: the README's case — server-managed fields are dropped
    // from what a caller has to supply.
    expectTypeOf<AppModel<string, User, Omit<User, 'createdAt'>>>().toEqualTypeOf<{
      id: string;
      read: User;
      write: Omit<User, 'createdAt'>;
    }>();

    // Omitted, the write type is the read type.
    expectTypeOf<AppModel<string, User>['write']>().toEqualTypeOf<User>();

    // The bare alias is the bound of every `Model extends AppModel`, so it has
    // to stay maximally permissive.
    expectTypeOf<AppModel>().toEqualTypeOf<{ id: unknown; read: unknown; write: unknown }>();
    expectTypeOf<AppModel<string, User, Omit<User, 'createdAt'>>>().toExtend<AppModel>();
  });

  // The README's "omit server-managed fields from the write type" case, at the
  // shape a caller actually writes it: a mapper whose write model drops a field
  // the read model carries, with the collection supplying it on write instead.
  it('Mapper accepts a model whose write type omits a read-only field', () => {
    type User = { id: string; name: string; createdAt: Date };
    type UserInput = Omit<User, 'createdAt'>;

    const mapper: Mapper<AuthorsCollection, AppModel<string, User, UserInput>> = {
      toDocRef: (id) => [id],
      fromFirestore: (doc) => ({
        id: doc.id[0],
        name: doc.data.name,
        createdAt: doc.data.registeredAt,
      }),
      toFirestore: (user) => ({
        id: [user.id],
        data: { name: user.name, registeredAt: serverTimestamp() },
      }),
    };

    expectTypeOf(mapper.toFirestore).parameter(0).toEqualTypeOf<UserInput>();
    expectTypeOf(mapper.fromFirestore).returns.toEqualTypeOf<User>();
  });

  it('DocumentDecodeError', () => {
    const cause = new Error('expected number, received string');
    const error = new DocumentDecodeError('Authors/a1', cause);

    // Catchable by class — the property a consumer branches on.
    expect(error).toBeInstanceOf(DocumentDecodeError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('DocumentDecodeError');

    // The document is named in both the structured field and the message, so
    // it survives a bare `console.error(e.message)` as well as inspection.
    expect(error.documentPath).toBe('Authors/a1');
    expect(error.message).toBe('failed to decode document "Authors/a1"');

    // The validation failure is kept rather than replaced: it is what says
    // which FIELD is wrong, while this error says which DOCUMENT.
    expect(error.cause).toBe(cause);
  });

  it('DocRef', () => {
    expectTypeOf<DocRef<AuthorsCollection>>().toEqualTypeOf<[string]>();
    expectTypeOf<DocRef<PostsCollection>>().toEqualTypeOf<[string, string]>();
    expectTypeOf<DocRef<CommentsCollection>>().toEqualTypeOf<[string, string, string]>();
    // A ref path is always a non-empty tuple (at least the doc id), so the loose
    // `DocRef<Collection>` is `[...string[], string]`, not a plain `string[]`.
    expectTypeOf<DocRef<Collection>>().toEqualTypeOf<[...string[], string]>();
  });
});

describe('subscribeDecoded', () => {
  /**
   * A stand-in for an SDK snapshot stream: hands back the two callbacks it was
   * given so a test can drive them, and counts how often the subscription was
   * released. `emitOnSubscribe` covers the one ordering the helper has to
   * special-case — a snapshot arriving before `subscribe` has returned, so
   * there is not yet an unsubscribe function to call.
   */
  const fakeStream = (emitOnSubscribe?: string) => {
    let emit: ((snapshot: string) => void) | undefined;
    let raise: ((error: Error) => void) | undefined;
    let released = 0;
    return {
      subscribe: (next: (snapshot: string) => void, error: (error: Error) => void): Unsubscribe => {
        emit = next;
        raise = error;
        if (emitOnSubscribe !== undefined) {
          next(emitOnSubscribe);
        }
        return () => {
          released += 1;
        };
      },
      emit: (snapshot: string) => emit?.(snapshot),
      raise: (error: Error) => raise?.(error),
      released: () => released,
    };
  };

  // Decodes anything but `'bad'`, which is the undecodable document.
  const decode = (snapshot: string): string => {
    if (snapshot === 'bad') {
      throw new Error('boom');
    }
    return `decoded:${snapshot}`;
  };

  it('delivers a decoded snapshot to next', () => {
    const stream = fakeStream();
    const received: string[] = [];
    subscribeDecoded(stream.subscribe, decode, (model) => received.push(model));

    stream.emit('a');
    stream.emit('b');

    expect(received).toStrictEqual(['decoded:a', 'decoded:b']);
    expect(stream.released()).toBe(0);
  });

  it('routes a decode failure to error, and delivers nothing to next', () => {
    const stream = fakeStream();
    const received: string[] = [];
    const errors: Error[] = [];
    subscribeDecoded(
      stream.subscribe,
      decode,
      (model) => received.push(model),
      (e) => errors.push(e),
    );

    stream.emit('bad');

    expect(received).toStrictEqual([]);
    expect(errors).toStrictEqual([new Error('boom')]);
  });

  it('ends the subscription on a decode failure', () => {
    const stream = fakeStream();
    const received: string[] = [];
    const errors: Error[] = [];
    subscribeDecoded(
      stream.subscribe,
      decode,
      (model) => received.push(model),
      (e) => errors.push(e),
    );

    stream.emit('bad');
    // A stream that keeps pushing must not produce a second error, nor start
    // delivering again once the failure has been reported.
    stream.emit('bad');
    stream.emit('a');

    expect(stream.released()).toBe(1);
    expect(errors.length).toBe(1);
    expect(received).toStrictEqual([]);
  });

  it('releases a subscription whose failure landed before subscribe returned', () => {
    const stream = fakeStream('bad');
    const errors: Error[] = [];
    subscribeDecoded(
      stream.subscribe,
      decode,
      () => undefined,
      (e) => errors.push(e),
    );

    expect(errors.length).toBe(1);
    expect(stream.released()).toBe(1);
  });

  it('rethrows asynchronously when no error handler was given', () => {
    const stream = fakeStream();
    const scheduled: (() => void)[] = [];
    vi.stubGlobal('queueMicrotask', (task: () => void) => scheduled.push(task));
    try {
      subscribeDecoded(stream.subscribe, decode, () => undefined);

      // Nothing escapes the emit itself — that is the whole point, since the
      // SDK calls it from inside its own stream handling.
      expect(() => stream.emit('bad')).not.toThrow();
      expect(stream.released()).toBe(1);
      expect(scheduled.length).toBe(1);
      expect(() => scheduled[0]?.()).toThrow('boom');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('wraps a thrown non-Error value', () => {
    const stream = fakeStream();
    const errors: Error[] = [];
    subscribeDecoded(
      stream.subscribe,
      () => {
        throw 'just a string';
      },
      () => undefined,
      (e) => errors.push(e),
    );

    stream.emit('a');

    expect(errors).toStrictEqual([new Error('just a string')]);
  });

  it('lets an exception from next propagate instead of reporting it as a stream failure', () => {
    const stream = fakeStream();
    const errors: Error[] = [];
    subscribeDecoded(
      stream.subscribe,
      decode,
      () => {
        throw new Error('the consumer blew up');
      },
      (e) => errors.push(e),
    );

    expect(() => stream.emit('a')).toThrow('the consumer blew up');
    expect(errors).toStrictEqual([]);
    expect(stream.released()).toBe(0);
  });

  it('routes a stream failure to error and ends the subscription', () => {
    const stream = fakeStream();
    const received: string[] = [];
    const errors: Error[] = [];
    subscribeDecoded(
      stream.subscribe,
      decode,
      (model) => received.push(model),
      (e) => errors.push(e),
    );

    stream.raise(new Error('stream died'));
    stream.emit('a');

    expect(errors).toStrictEqual([new Error('stream died')]);
    expect(stream.released()).toBe(1);
    expect(received).toStrictEqual([]);
  });

  it('releases the subscription when the caller unsubscribes', () => {
    const stream = fakeStream();
    const received: string[] = [];
    const unsubscribe = subscribeDecoded(stream.subscribe, decode, (m) => received.push(m));

    stream.emit('a');
    unsubscribe();
    stream.emit('b');

    expect(received).toStrictEqual(['decoded:a']);
    expect(stream.released()).toBe(1);
  });
});
