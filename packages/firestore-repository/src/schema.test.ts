import { describe, expectTypeOf, it } from 'vitest';
import type { ServerTimestamp, Timestamp } from './document.js';
import {
  type Collection,
  type Doc,
  type DocRef,
  type DocToWrite,
  rootCollection,
  schemaWithoutValidation,
  subCollection,
} from './schema.js';

describe('schema', () => {
  const authorsCollection = rootCollection({
    name: 'Authors',
    data: schemaWithoutValidation<{ name: string; registeredAt: Timestamp }>(),
  });

  const postsCollection = subCollection({
    name: 'Posts',
    data: schemaWithoutValidation<{ title: string; postedAt: Timestamp }>(),
    parent: authorsCollection,
  });

  const commentsCollection = subCollection({
    name: 'Comments',
    data: schemaWithoutValidation<{ content: string; commentedAt: Timestamp }>(),
    parent: postsCollection,
  });

  type AuthorsCollection = typeof authorsCollection;
  type PostsCollection = typeof postsCollection;
  type CommentsCollection = typeof commentsCollection;

  it('Doc', () => {
    expectTypeOf<Doc<AuthorsCollection>>().toMatchTypeOf<{
      id: string;
      parent?: undefined;
      data: { name: string; registeredAt: Timestamp };
    }>();
  });

  it('DocToWrite', () => {
    expectTypeOf<DocToWrite<AuthorsCollection>>().toMatchTypeOf<{
      id: string;
      parent?: undefined;
      data: { name: string; registeredAt: Timestamp | Date | ServerTimestamp };
    }>();

    expectTypeOf<Doc<AuthorsCollection>>().toExtend<DocToWrite<AuthorsCollection>>();
    expectTypeOf<Doc<PostsCollection>>().toExtend<DocToWrite<PostsCollection>>();
    expectTypeOf<Doc<CommentsCollection>>().toExtend<DocToWrite<CommentsCollection>>();
    (<T extends Collection>() => {
      // check type compatibility
      let a!: Doc<T>;
      const _b: DocToWrite<T> = a;
      // FIXME this assertion should be passed
      // expectTypeOf<Doc<T>>().toExtend<DocToWrite<T>>();
    })();
  });

  it('DocRef', () => {
    expectTypeOf<DocRef<AuthorsCollection>>().toEqualTypeOf<{ id: string; parent?: undefined }>();
    expectTypeOf<DocRef<PostsCollection>>().toEqualTypeOf<{
      id: string;
      parent: { id: string; parent?: undefined };
    }>();
    expectTypeOf<DocRef<CommentsCollection>>().toEqualTypeOf<{
      id: string;
      parent: { id: string; parent: { id: string; parent?: undefined } };
    }>();

    expectTypeOf<Doc<AuthorsCollection>>().toExtend<DocRef<AuthorsCollection>>();
    expectTypeOf<Doc<PostsCollection>>().toExtend<DocRef<PostsCollection>>();
    expectTypeOf<Doc<CommentsCollection>>().toExtend<DocRef<CommentsCollection>>();
    (<T extends Collection>() => {
      // check type compatibility
      let a!: Doc<T>;
      const _b: DocRef<T> = a;
      // FIXME this assertion should be passed
      // expectTypeOf<Doc<T>>().toExtend<DocRef<T>>();
    })();

    expectTypeOf<DocToWrite<AuthorsCollection>>().toExtend<DocRef<AuthorsCollection>>();
    expectTypeOf<DocToWrite<PostsCollection>>().toExtend<DocRef<PostsCollection>>();
    expectTypeOf<DocToWrite<CommentsCollection>>().toExtend<DocRef<CommentsCollection>>();
    (<T extends Collection>() => {
      // check type compatibility
      let a!: DocToWrite<T>;
      const _b: DocRef<T> = a;
      // FIXME this assertion should be passed
      // expectTypeOf<DocToWrite<T>>().toExtend<DocRef<T>>();
    })();
  });
});
