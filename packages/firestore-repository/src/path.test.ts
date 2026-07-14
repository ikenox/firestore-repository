import { describe, expect, expectTypeOf, it } from 'vitest';

import { parseRefPath, collectionPath, documentPath, refPath, toDocRef } from './path.js';
import { type RefPath, rootCollection, string, subCollection } from './schema.js';

describe('path', () => {
  // Test collections
  const users = rootCollection({ name: 'Users', schema: { name: string() } });
  const posts = subCollection({ name: 'Posts', parent: ['Users'], schema: { title: string() } });
  const comments = subCollection({
    name: 'Comments',
    parent: ['Users', 'Posts'],
    schema: { text: string() },
  });

  describe('collectionPath', () => {
    it('should return collection name for root collection', () => {
      expect(collectionPath(users, [])).toBe('Users');
      expect(collectionPath(posts, ['user1'])).toBe('Users/user1/Posts');
      expect(collectionPath(comments, ['user1', 'post1'])).toBe('Users/user1/Posts/post1/Comments');
    });
  });

  describe('refPath', () => {
    it('interleaves collection names into the segment path', () => {
      expect(refPath(users, ['user1'])).toStrictEqual(['Users', 'user1']);
      expect(refPath(posts, ['user1', 'post1'])).toStrictEqual([
        'Users',
        'user1',
        'Posts',
        'post1',
      ]);
      expect(refPath(comments, ['user1', 'post1', 'comment1'])).toStrictEqual([
        'Users',
        'user1',
        'Posts',
        'post1',
        'Comments',
        'comment1',
      ]);
    });

    it('types collection-name positions as literals', () => {
      expectTypeOf(refPath(users, ['user1'])).toEqualTypeOf<['Users', string]>();
      expectTypeOf(refPath(posts, ['user1', 'post1'])).toEqualTypeOf<
        ['Users', string, 'Posts', string]
      >();
      expectTypeOf<RefPath<'unknown'>>().toEqualTypeOf<string[]>();
    });
  });

  describe('toDocRef', () => {
    it('extracts the ids-only address from a segment path', () => {
      expect(toDocRef(users, ['Users', 'user1'])).toStrictEqual(['user1']);
      expect(toDocRef(posts, ['Users', 'user1', 'Posts', 'post1'])).toStrictEqual([
        'user1',
        'post1',
      ]);
      expect(
        toDocRef(comments, ['Users', 'user1', 'Posts', 'post1', 'Comments', 'comment1']),
      ).toStrictEqual(['user1', 'post1', 'comment1']);
      expectTypeOf(toDocRef(posts, refPath(posts, ['user1', 'post1']))).toEqualTypeOf<
        [string, string]
      >();
    });

    it('fails loudly on a lying type assertion instead of yielding wrong ids', () => {
      const wide: string[] = ['Posts', 'post1'];
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- deliberately lying, to exercise the guard
      const lying = wide as RefPath<typeof users>;
      expect(() => toDocRef(users, lying)).toThrow(/segment 0 is 'Posts', expected 'Users'/);
    });

    it('takes typed paths only: a path of the wrong collection is a compile error', () => {
      // @ts-expect-error -- 4 segments cannot be a Users path
      void (() => toDocRef(users, ['Users', 'user1', 'Posts', 'post1']));
      // @ts-expect-error -- a Comments segment cannot appear in a Posts path
      void (() => toDocRef(posts, ['Users', 'user1', 'Comments', 'c1']));
      const postsPath = refPath(posts, ['user1', 'post1']);
      // @ts-expect-error -- a typed RefPath of another collection is rejected
      void (() => toDocRef(users, postsPath));
      const untyped: string[] = ['Users', 'user1'];
      // @ts-expect-error -- an untyped string[] must be narrowed with parseRefPath first
      void (() => toDocRef(users, untyped));
    });
  });

  describe('parseRefPath', () => {
    it('narrows an untyped (context-free) segment path after runtime validation', () => {
      const rootPath: string[] = ['Users', 'user1'];
      const root = parseRefPath(users, rootPath);
      expectTypeOf(root).toEqualTypeOf<['Users', string]>();
      expect(root).toStrictEqual(['Users', 'user1']);

      const subPath: string[] = ['Users', 'user1', 'Posts', 'post1'];
      const sub = parseRefPath(posts, subPath);
      expectTypeOf(sub).toEqualTypeOf<['Users', string, 'Posts', string]>();
      expect(sub).toStrictEqual(['Users', 'user1', 'Posts', 'post1']);

      const deepPath: string[] = ['Users', 'user1', 'Posts', 'post1', 'Comments', 'comment1'];
      expect(parseRefPath(comments, deepPath)).toStrictEqual(deepPath);
    });

    it('rejects a wrong segment count', () => {
      expect(() => parseRefPath(users, ['Users', 'user1', 'Posts', 'post1'])).toThrow(
        /expected 2 segments/,
      );
      expect(() => parseRefPath(posts, ['post1'])).toThrow(/expected 4 segments/);
      expect(() => parseRefPath(users, [])).toThrow(/expected 2 segments/);
    });

    it('rejects a wrong collection name at any name position', () => {
      expect(() => parseRefPath(users, ['Posts', 'user1'])).toThrow(
        /segment 0 is 'Posts', expected 'Users'/,
      );
      expect(() => parseRefPath(posts, ['Users', 'user1', 'Comments', 'c1'])).toThrow(
        /segment 2 is 'Comments', expected 'Posts'/,
      );
      expect(() => parseRefPath(comments, ['Users', 'u1', 'Posts', 'p1', 'Likes', 'l1'])).toThrow(
        /segment 4 is 'Likes', expected 'Comments'/,
      );
    });
  });

  describe('documentPath', () => {
    it('should return full path for document in subcollection (1 level)', () => {
      expect(documentPath(users, ['user1'])).toBe('Users/user1');
      expect(documentPath(posts, ['user1', 'post1'])).toBe('Users/user1/Posts/post1');
      expect(documentPath(comments, ['user1', 'post1', 'comment1'])).toBe(
        'Users/user1/Posts/post1/Comments/comment1',
      );
    });
  });
});
