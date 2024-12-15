import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Timestamp } from './document.js';
import {
  type DbModel,
  type Id,
  type IsRootCollection,
  type Model,
  type ParentId,
  collection,
  collectionPath,
  docPath,
  id,
  parentPath,
} from './schema.js';

// root collection
const authorsCollection = collection({
  name: 'Authors',
  data: {
    from: (data: {
      authorId: string;
      name: string;
      registeredAt: Timestamp;
    }) => ({
      ...data,
      registeredAt: data.registeredAt.toDate(),
    }),
    to: (data) => data,
  },
  id: id('authorId'),
});

// subcollection
const postsCollection = collection({
  name: 'Posts',
  data: {
    from: (data: {
      postId: number;
      title: string;
      postedAt: Timestamp;
      authorId: string;
    }) => ({
      ...data,
      postedAt: data.postedAt.toDate(),
    }),
    to: (data) => data,
  },
  id: id('postId'),
  parentPath: parentPath(authorsCollection, 'authorId'),
});

type Authors = typeof authorsCollection;
type Posts = typeof postsCollection;

describe('schema', () => {
  describe('schema types', () => {
    it('root collection', () => {
      expectTypeOf<Id<Authors>>().toEqualTypeOf<{ authorId: string }>();
      expectTypeOf<ParentId<Authors>>().toEqualTypeOf<Record<never, never>>();
      expectTypeOf<Model<Authors>>().toEqualTypeOf<{
        authorId: string;
        name: string;
        registeredAt: Date;
      }>();
      expectTypeOf<DbModel<Authors>>().toEqualTypeOf<{
        authorId: string;
        name: string;
        registeredAt: Timestamp;
      }>();
    });

    it('subcollection', () => {
      expectTypeOf<Id<Posts>>().toEqualTypeOf<{ postId: number; authorId: string }>();
      expectTypeOf<ParentId<Posts>>().toEqualTypeOf<{ authorId: string }>();
      expectTypeOf<Model<Posts>>().toEqualTypeOf<{
        postId: number;
        authorId: string;
        title: string;
        postedAt: Date;
      }>();
      expectTypeOf<DbModel<Posts>>().toEqualTypeOf<{
        postId: number;
        authorId: string;
        title: string;
        postedAt: Timestamp;
      }>();
    });
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

  it('IsSubcollection', () => {
    expectTypeOf<IsRootCollection<Authors>>().toEqualTypeOf<true>();
    expectTypeOf<IsRootCollection<Posts>>().toEqualTypeOf<false>();
  });
});
