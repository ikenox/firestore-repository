import { expect } from 'vitest';
import type { CollectionSchema } from '../schema.js';

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

/**
 * Sleep during the specified milliseconds
 */
export const sleep = (millis: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, millis));

export const expectArrayEqualsWithoutOrder = <T>(actual: T[], expected: T[]): void => {
  // biome-ignore lint/suspicious/noMisplacedAssertion: <explanation>
  expect(actual.length).toStrictEqual(expected.length);
  // biome-ignore lint/suspicious/noMisplacedAssertion: <explanation>
  expect(actual).toStrictEqual(expect.arrayContaining(expected));
};
