import { describe, expect, it } from 'vitest';
import { collectionPath, documentPath } from './path.js';
import { rootCollection, schemaWithoutValidation, subCollection } from './schema.js';

describe('path', () => {
  // Test collections
  const users = rootCollection({
    name: 'Users',
    data: schemaWithoutValidation<{ name: string }>(),
  });

  const posts = subCollection({
    name: 'Posts',
    parent: users,
    data: schemaWithoutValidation<{ title: string }>(),
  });

  const comments = subCollection({
    name: 'Comments',
    parent: posts,
    data: schemaWithoutValidation<{ text: string }>(),
  });

  describe('collectionPath', () => {
    it('should return collection name for root collection', () => {
      expect(collectionPath(users, undefined)).toBe('Users');
    });

    it('should return full path for subcollection (1 level)', () => {
      const parentDoc = { id: 'user1' };
      expect(collectionPath(posts, parentDoc)).toBe('Users/user1/Posts');
    });

    it('should return full path for nested subcollection (2 levels)', () => {
      const userDoc = { id: 'user1' };
      const postDoc = { id: 'post1', parent: userDoc };
      expect(collectionPath(comments, postDoc)).toBe('Users/user1/Posts/post1/Comments');
    });

    it('should handle different parent document IDs correctly', () => {
      const parentDoc1 = { id: 'user-abc' };
      const parentDoc2 = { id: 'user-xyz' };
      expect(collectionPath(posts, parentDoc1)).toBe('Users/user-abc/Posts');
      expect(collectionPath(posts, parentDoc2)).toBe('Users/user-xyz/Posts');
    });
  });

  describe('documentPath', () => {
    it('should return full path for document in root collection', () => {
      const docRef = { id: 'user1' };
      expect(documentPath(users, docRef)).toBe('Users/user1');
    });

    it('should return full path for document in subcollection (1 level)', () => {
      const userDoc = { id: 'user1' };
      const postRef = { id: 'post1', parent: userDoc };
      expect(documentPath(posts, postRef)).toBe('Users/user1/Posts/post1');
    });

    it('should return full path for document in nested subcollection (2 levels)', () => {
      const userDoc = { id: 'user1' };
      const postDoc = { id: 'post1', parent: userDoc };
      const commentRef = { id: 'comment1', parent: postDoc };
      expect(documentPath(comments, commentRef)).toBe('Users/user1/Posts/post1/Comments/comment1');
    });

    it('should handle document IDs with special characters', () => {
      const docRef = { id: 'user-123_abc.xyz' };
      expect(documentPath(users, docRef)).toBe('Users/user-123_abc.xyz');
    });

    it('should handle different document IDs in the same collection', () => {
      const docRef1 = { id: 'doc1' };
      const docRef2 = { id: 'doc2' };
      expect(documentPath(users, docRef1)).toBe('Users/doc1');
      expect(documentPath(users, docRef2)).toBe('Users/doc2');
    });

    it('should correctly build path with multiple nested levels', () => {
      const userDoc = { id: 'alice' };
      const postDoc = { id: 'my-post', parent: userDoc };
      const commentRef = { id: 'great-comment', parent: postDoc };

      expect(documentPath(comments, commentRef)).toBe(
        'Users/alice/Posts/my-post/Comments/great-comment',
      );
    });
  });

  describe('integration', () => {
    it('should maintain consistency between collectionPath and documentPath', () => {
      const userDoc = { id: 'user1' };
      const postRef = { id: 'post1', parent: userDoc };

      const expectedCollectionPath = 'Users/user1/Posts';
      const expectedDocumentPath = 'Users/user1/Posts/post1';

      expect(collectionPath(posts, userDoc)).toBe(expectedCollectionPath);
      expect(documentPath(posts, postRef)).toBe(expectedDocumentPath);
      expect(documentPath(posts, postRef)).toBe(`${expectedCollectionPath}/post1`);
    });
  });
});
