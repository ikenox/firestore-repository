import type { CollectionSchema } from '../index.js';

/**
 * Generates random number.
 */
export const randomNumber = () => 1000000 + Math.floor(Math.random() * 1000000);

/**
 * Generates random string.
 */
export const randomString = () => Math.random().toString(36).slice(2);

/**
 * Duplicates a collection config with a unique collection name
 */
export const uniqueCollection = <T extends CollectionSchema>(collection: T): T => ({
  ...collection,
  name: `${collection.name}_${randomString()}`,
});
