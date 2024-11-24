import { describe, expectTypeOf, it } from 'vitest';
import { Timestamp, collection } from './index.js';

describe('CollectionSchema', () => {
  const authors = collection({
    name: 'Authors',
    id: {
      from: (authorId) => ({ authorId }),
      to: ({ authorId }) => authorId,
    },
    data: {
      from: (data: { name: string; registeredAt: Timestamp }) => data,
      to: (data) => data,
    },
  });

  const posts = collection({
    name: 'Posts',
    id: {
      from: (postId) => ({ postId }),
      to: ({ postId }) => postId,
    },
    parent: {
      schema: authors,
      from: ({ authorId }) => ({ authorId }),
      to: ({ authorId }) => ({ authorId }),
    },
    data: {
      from: (data: { title: string; postedAt: Timestamp }) => ({
        ...data,
      }),
      to: (data) => ({ ...data }),
    },
  });

  type AuthorsCollection = typeof authors;
  type PostsCollection = typeof posts;

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
});
