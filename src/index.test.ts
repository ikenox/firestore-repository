import { describe, expect, expectTypeOf, it } from 'vitest';
import { Timestamp, as, collection, docPath } from './index.js';

describe('CollectionSchema', () => {
  type AuthorsCollection = typeof authorsCollection;
  type PostsCollection = typeof postsCollection;

  it('type', () => {
    // FIXME
    expectTypeOf<AuthorsCollection['$dbModel']>().toEqualTypeOf<{}>();
    expectTypeOf<AuthorsCollection['$id']>().toEqualTypeOf<{}>();
    expectTypeOf<AuthorsCollection['$parentId']>().toEqualTypeOf<{}>();
    expectTypeOf<AuthorsCollection['$model']>().toEqualTypeOf<{}>();

    expectTypeOf<PostsCollection['$dbModel']>().toEqualTypeOf<{}>();
    expectTypeOf<PostsCollection['$id']>().toEqualTypeOf<{}>();
    expectTypeOf<PostsCollection['$parentId']>().toEqualTypeOf<{}>();
    expectTypeOf<PostsCollection['$model']>().toEqualTypeOf<{}>();

    // why?
    expectTypeOf<number>().toEqualTypeOf<string>();
  });

  it('docPath', () => {
    expect(docPath(authorsCollection, { authorId: 'abc' })).toBe('Authors/abc');
    expect(docPath(postsCollection, { postId: 123, authorId: 'abc' })).toBe(
      `Authors/abc/Posts/123`,
    );
  });

  it('collectionPath', () => {});
});

/**
 * Root collection
 */
const authorsCollection = collection({
  name: 'Authors',
  id: as('authorId'),
  data: {
    from: (data: { name: string; registeredAt: Timestamp }) => ({
      ...data,
    }),
    to: ({ name, registeredAt }) => ({
      name,
      registeredAt,
    }),
  },
});

/**
 * Subcollection
 */
const postsCollection = collection({
  name: 'Posts',
  id: {
    from: (postId) => ({ postId: Number(postId) }),
    to: ({ postId }) => postId.toString(),
  },
  parent: {
    schema: authorsCollection,
    id: {
      from: ({ authorId }) => ({ authorId }),
      to: ({ authorId }) => ({ authorId }),
    },
  },
  data: {
    from: (data: { title: string; postedAt: Timestamp }) => ({
      ...data,
    }),
    to: (data) => ({ ...data }),
  },
});
