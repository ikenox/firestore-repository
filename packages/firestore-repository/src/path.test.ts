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
    parent: ['Users'],
    data: schemaWithoutValidation<{ title: string }>(),
  });

  const comments = subCollection({
    name: 'Comments',
    parent: ['Users', 'Posts'],
    data: schemaWithoutValidation<{ text: string }>(),
  });

  describe('collectionPath', () => {
    it('should return collection name for root collection', () => {
      expect(collectionPath(users, [])).toBe('Users');
      expect(collectionPath(posts, ['user1'])).toBe('Users/user1/Posts');
      expect(collectionPath(comments, ['user1', 'post1'])).toBe('Users/user1/Posts/post1/Comments');
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
