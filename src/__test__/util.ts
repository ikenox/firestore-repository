import crypto from 'crypto';
import { Repository } from '../index.js';

/**
 * Delete all documents of the specified collection
 */
export const deleteAll = <T extends Repository>(
  repository: T,
  parentId: T['collection']['$parentId'],
) => repository.query(parentId).then((docs) => repository.batchDelete(docs));

export const randomNumber = () => 1000000 + Math.floor(Math.random() * 1000000);

export const randomString = () => Math.random().toString(36).slice(-16);
