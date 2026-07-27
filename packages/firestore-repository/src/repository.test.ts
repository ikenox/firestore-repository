import { describe, expect, expectTypeOf, it } from 'vitest';

import { AppModel, Doc, DocRef, DocumentDecodeError, Mapper } from './repository.js';
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
