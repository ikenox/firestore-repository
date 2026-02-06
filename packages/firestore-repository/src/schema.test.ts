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
    parent: ['Authors'],
  });

  const commentsCollection = subCollection({
    name: 'Comments',
    data: schemaWithoutValidation<{ content: string; commentedAt: Timestamp }>(),
    parent: ['Authors', 'Posts'],
  });

  type AuthorsCollection = typeof authorsCollection;
  type PostsCollection = typeof postsCollection;
  type CommentsCollection = typeof commentsCollection;

  it('Doc', () => {
    expectTypeOf<Doc<AuthorsCollection>>().toEqualTypeOf<{
      ref: [string];
      data: { name: string; registeredAt: Timestamp };
    }>();
  });

  it('DocToWrite', () => {
    expectTypeOf<DocToWrite<AuthorsCollection>>().toMatchTypeOf<{
      ref: [string];
      data: { name: string; registeredAt: Timestamp | Date | ServerTimestamp };
    }>();

    expectTypeOf<Doc<AuthorsCollection>>().toExtend<DocToWrite<AuthorsCollection>>();
    expectTypeOf<Doc<PostsCollection>>().toExtend<DocToWrite<PostsCollection>>();
    expectTypeOf<Doc<CommentsCollection>>().toExtend<DocToWrite<CommentsCollection>>();
    (<T extends Collection>() => {
      // check type compatibility
      expectTypeOf<Doc<T>>().toExtend<DocToWrite<T>>();
    })();
  });

  it('DocRef', () => {
    expectTypeOf<DocRef<AuthorsCollection>>().toEqualTypeOf<[string]>();
    expectTypeOf<DocRef<PostsCollection>>().toEqualTypeOf<[string, string]>();
    expectTypeOf<DocRef<CommentsCollection>>().toEqualTypeOf<[string, string, string]>();
    expectTypeOf<DocRef<Collection>>().toEqualTypeOf<string[]>();
  });
});
