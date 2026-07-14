import { describe, expect, expectTypeOf, it } from 'vitest';

import { collectionPath, documentPath, refPath, toDocRef } from './path.js';
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
    });

    it('accepts an untyped (context-free) segment path after runtime validation', () => {
      const untyped: string[] = ['Users', 'user1', 'Posts', 'post1'];
      expect(toDocRef(posts, untyped)).toStrictEqual(['user1', 'post1']);
    });

    it('rejects a tuple-shaped path of the wrong collection at compile time', () => {
      // @ts-expect-error -- 4 segments cannot be a Users path
      expect(() => toDocRef(users, ['Users', 'user1', 'Posts', 'post1'])).toThrow();
      // @ts-expect-error -- a Comments segment cannot appear in a Posts path
      expect(() => toDocRef(posts, ['Users', 'user1', 'Comments', 'c1'])).toThrow();
      const postsPath = refPath(posts, ['user1', 'post1']);
      // @ts-expect-error -- a typed RefPath of another collection is rejected
      expect(() => toDocRef(users, postsPath)).toThrow();
    });

    it('rejects an untyped path that does not belong to the collection at runtime', () => {
      const tooLong: string[] = ['Users', 'user1', 'Posts', 'post1'];
      expect(() => toDocRef(users, tooLong)).toThrow(/expected 2 segments/);
      const wrongName: string[] = ['Users', 'user1', 'Comments', 'c1'];
      expect(() => toDocRef(posts, wrongName)).toThrow(/segment 2 is 'Comments', expected 'Posts'/);
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
