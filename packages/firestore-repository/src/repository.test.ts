import { describe, expectTypeOf, it } from 'vitest';

import { Doc, DocRef } from './repository.js';
import {
  Collection,
  rootCollection,
  ServerTimestamp,
  string,
  subCollection,
  timestamp,
} from './schema.js';

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
    expectTypeOf<Doc<AuthorsCollection, 'read'>>().toEqualTypeOf<{
      id: [string];
      data: { name: string; registeredAt: Date };
    }>();
    expectTypeOf<Doc<AuthorsCollection, 'write'>>().toEqualTypeOf<{
      id: [string];
      data: { name: string; registeredAt: Date | ServerTimestamp };
    }>();

    // read model type should be always compatible to write model
    expectTypeOf<Doc<AuthorsCollection, 'read'>>().toExtend<Doc<AuthorsCollection, 'write'>>();
    expectTypeOf<Doc<PostsCollection, 'read'>>().toExtend<Doc<PostsCollection, 'write'>>();
    expectTypeOf<Doc<CommentsCollection, 'read'>>().toExtend<Doc<CommentsCollection, 'write'>>();

    // TODO: this assertion should be passed
    (<T extends Collection>() => {
      // @ts-expect-error -- TODO: this assertion should be passed once generic constraint is resolved
      expectTypeOf<Doc<T, 'read'>>().toExtend<Doc<T, 'write'>>();
    })();
  });

  it('DocRef', () => {
    expectTypeOf<DocRef<AuthorsCollection>>().toEqualTypeOf<[string]>();
    expectTypeOf<DocRef<PostsCollection>>().toEqualTypeOf<[string, string]>();
    expectTypeOf<DocRef<CommentsCollection>>().toEqualTypeOf<[string, string, string]>();
    expectTypeOf<DocRef<Collection>>().toEqualTypeOf<string[]>();
  });
});
