import { describe, expect, expectTypeOf, it } from 'vitest';
import * as z from 'zod';

import type { ServerTimestamp, Timestamp } from './document.js';
import {
  type Collection,
  type Doc,
  type DocData,
  type DocRef,
  type DocToWrite,
  rootCollection,
  schemaFromValidator,
  schemaWithoutValidation,
  subCollection,
} from './schema.js';

describe('schema', () => {
  const authorsCollection = rootCollection({
    name: 'Authors',
    data: schemaWithoutValidation<{ name: string; registeredAt: Timestamp }>(),
  });

  const postsCollection = subCollection({
    name: 'Posts',
    data: schemaWithoutValidation<{ title: string; postedAt: Timestamp }>(),
    parent: ['Authors'],
  });

  const commentsCollection = subCollection({
    name: 'Comments',
    data: schemaWithoutValidation<{ content: string; commentedAt: Timestamp }>(),
    parent: ['Authors', 'Posts'],
  });

  type AuthorsCollection = typeof authorsCollection;
  type PostsCollection = typeof postsCollection;
  type CommentsCollection = typeof commentsCollection;

  it('Doc', () => {
    expectTypeOf<Doc<AuthorsCollection>>().toEqualTypeOf<{
      ref: [string];
      data: { name: string; registeredAt: Timestamp };
    }>();
  });

  it('DocToWrite', () => {
    expectTypeOf<DocToWrite<AuthorsCollection>>().toMatchTypeOf<{
      ref: [string];
      data: { name: string; registeredAt: Timestamp | Date | ServerTimestamp };
    }>();

    expectTypeOf<Doc<AuthorsCollection>>().toExtend<DocToWrite<AuthorsCollection>>();
    expectTypeOf<Doc<PostsCollection>>().toExtend<DocToWrite<PostsCollection>>();
    expectTypeOf<Doc<CommentsCollection>>().toExtend<DocToWrite<CommentsCollection>>();
    (<T extends Collection>() => {
      // check type compatibility
      expectTypeOf<Doc<T>>().toExtend<DocToWrite<T>>();
    })();
  });

  it('DocRef', () => {
    expectTypeOf<DocRef<AuthorsCollection>>().toEqualTypeOf<[string]>();
    expectTypeOf<DocRef<PostsCollection>>().toEqualTypeOf<[string, string]>();
    expectTypeOf<DocRef<CommentsCollection>>().toEqualTypeOf<[string, string, string]>();
    expectTypeOf<DocRef<Collection>>().toEqualTypeOf<string[]>();
  });

  describe('schemaFromValidator', () => {
    it('infers correct type from object schema', () => {
      const schema = schemaFromValidator(
        z.object({ field1: z.string(), field2: z.union([z.string(), z.number()]) }),
      );
      expectTypeOf(schema.validate).returns.toEqualTypeOf<{
        field1: string;
        field2: string | number;
      }>();
    });

    it('works with rootCollection', () => {
      const collection = rootCollection({
        name: 'Test',
        data: schemaFromValidator(z.object({ name: z.string(), age: z.number() })),
      });
      expectTypeOf<DocData<typeof collection>>().toEqualTypeOf<{ name: string; age: number }>();
    });

    it('validates data at runtime', () => {
      const schema = schemaFromValidator(z.object({ name: z.string() }));
      expect(schema.validate({ name: 'test' })).toEqual({ name: 'test' });
      expect(() => schema.validate({ name: 123 })).toThrow('validation failed');
    });

    it('rejects async schema at runtime', () => {
      const asyncSchema = {
        '~standard': {
          version: 1 as const,
          vendor: 'test',
          validate: () => Promise.resolve({ value: {} }),
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- mock type for testing
          types: {} as { input: unknown; output: Record<string, never> },
        },
      };
      const schema = schemaFromValidator(asyncSchema);
      expect(() => schema.validate({})).toThrow('Schema validation must be synchronous');
    });

    it('rejects non-DocumentData schema at type level', () => {
      // @ts-expect-error -- string output doesn't extend DocumentData
      schemaFromValidator(z.string());

      // @ts-expect-error -- number output doesn't extend DocumentData
      schemaFromValidator(z.number());

      // @ts-expect-error -- array output doesn't extend DocumentData
      schemaFromValidator(z.array(z.string()));

      // @ts-expect-error -- date output doesn't extend DocumentData
      schemaFromValidator(z.object({ field1: z.date() }));
    });
  });
});
