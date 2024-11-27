import { describe, expect, expectTypeOf, it } from 'vitest';
import { type Timestamp, as, collection, collectionPath, docPath } from './index.js';

describe('CollectionSchema', () => {
  type AuthorsCollection = typeof authorsCollection;
  type PostsCollection = typeof postsCollection;

  it('type', () => {
    // FIXME
    expectTypeOf<AuthorsCollection['$dbModel']>().toEqualTypeOf<never>();
    expectTypeOf<AuthorsCollection['$id']>().toEqualTypeOf<never>();
    expectTypeOf<AuthorsCollection['$parentId']>().toEqualTypeOf<never>();
    expectTypeOf<AuthorsCollection['$model']>().toEqualTypeOf<never>();

    expectTypeOf<PostsCollection['$dbModel']>().toEqualTypeOf<never>();
    expectTypeOf<PostsCollection['$id']>().toEqualTypeOf<never>();
    expectTypeOf<PostsCollection['$parentId']>().toEqualTypeOf<never>();
    expectTypeOf<PostsCollection['$model']>().toEqualTypeOf<never>();

    // why?
    expectTypeOf<number>().toEqualTypeOf<string>();
  });

  it('docPath', () => {
    expect(docPath(authorsCollection, { authorId: 'abc' })).toBe('Authors/abc');
    expect(docPath(postsCollection, { postId: 123, authorId: 'abc' })).toBe(
      'Authors/abc/Posts/123',
    );
  });

  it('collectionPath', () => {
    expect(collectionPath(authorsCollection, {})).toBe('Authors');
    expect(collectionPath(postsCollection, { authorId: 'abc' })).toBe('Authors/abc/Posts');
  });
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
