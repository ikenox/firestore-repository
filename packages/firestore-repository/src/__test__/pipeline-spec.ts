import { assert, beforeEach, describe, expect, it } from 'vitest';

import { constant, equal } from '../pipelines/expression.js';
import { asc, desc } from '../pipelines/ordering.js';
import type {
  Pipeline,
  PipelineQueryExecutor,
  PipelineResult,
  PipelineRowIdentity,
} from '../pipelines/pipeline.js';
import { collection as collectionInput } from '../pipelines/source.js';
import type { Doc, DocRef, FirestoreEnvironment, PlainRepository } from '../repository.js';
import type { Collection, DocumentSchema } from '../schema.js';
import { type AuthorsCollection, authorsCollection } from './specification.js';
import { uniqueCollection } from './util.js';

/**
 * Behavioural spec that every pipeline-query adapter (`@firebase/firestore`,
 * `@google-cloud/firestore`) must satisfy. Implementations pass their
 * {@link PipelineQueryExecutor} plus a `createRepository` used only to seed data.
 *
 * Requires a Firestore **Enterprise** database — pipelines are Enterprise-only,
 * so this cannot run against the emulator.
 */
export const definePipelineSpecificationTests = <Env extends FirestoreEnvironment>({
  executor,
  createRepository,
}: {
  executor: PipelineQueryExecutor;
  createRepository: <T extends Collection>(collection: T) => PlainRepository<T, Env>;
}) => {
  // Seeded (re-written) into a fresh unique collection before each test.
  const items: [Doc<AuthorsCollection>, Doc<AuthorsCollection>, Doc<AuthorsCollection>] = [
    {
      id: ['a1'],
      data: { name: 'alice', profile: { age: 20, gender: 'female' }, rank: 1, tag: ['x'] },
    },
    { id: ['a2'], data: { name: 'bob', profile: { age: 30 }, rank: 2, tag: [] } },
    {
      id: ['a3'],
      data: { name: 'carol', profile: { age: 40, gender: 'male' }, rank: 3, tag: ['y', 'z'] },
    },
  ];

  const setup = () => {
    let collection: AuthorsCollection;
    beforeEach(async () => {
      collection = uniqueCollection(authorsCollection);
      await createRepository(collection).batchSet(items);
    });

    /** The input stage (`collection(...)`) for the seeded collection. */
    const source = (): Pipeline<AuthorsCollection['schema'], DocRef<AuthorsCollection>> =>
      collectionInput(collection);

    /**
     * Executes `pipeline` (built from {@link source}) and asserts the result rows
     * equal `expected`.
     *
     * Order-sensitive by default (the result order is part of what a query
     * asserts — e.g. `sort` / `limit`). For queries whose order is unspecified
     * (e.g. a bare `collection` input, whose order is Firestore-internal), pass
     * `{ ordered: false }` to compare as a set.
     */
    const expectPipeline = async <S extends DocumentSchema, Id extends PipelineRowIdentity>(
      pipeline: Pipeline<S, Id>,
      // `NoInfer` so `S`/`Id` are inferred from `pipeline` only, not from the
      // expected rows (which would otherwise widen `S` to its constraint).
      expected: readonly NoInfer<PipelineResult<S, Id>>[],
      options?: { ordered?: boolean },
    ): Promise<void> => {
      const results = await executor.execute(pipeline);
      if (options?.ordered === false) {
        // The result order of an unordered query is unspecified — compare as a
        // set (order-independent deep equality).
        assert.sameDeepMembers(results, [...expected]);
      } else {
        expect(results).toStrictEqual(expected);
      }
    };

    return { items, source, expectPipeline };
  };

  describe('pipeline specification', () => {
    const { items, source, expectPipeline } = setup();

    describe('input source (no transformation stages)', () => {
      it('fetches all documents of a collection with their ids', async () => {
        // A bare collection input has no defined order, so compare as a set.
        await expectPipeline(source(), items, { ordered: false });
      });
    });

    describe('sort', () => {
      // items are seeded with rank 1 / 2 / 3 for a1 / a2 / a3.
      const [a1, a2, a3] = items;

      it('sorts by a field ascending', async () => {
        await expectPipeline(
          source().sort((field) => [asc(field('rank'))]),
          [a1, a2, a3],
        );
      });

      it('sorts by a field descending', async () => {
        await expectPipeline(
          source().sort((field) => [desc(field('rank'))]),
          [a3, a2, a1],
        );
      });
    });

    describe('select', () => {
      it('projects a single top-level field, dropping row identity', async () => {
        // `select` breaks read-identity: the result rows carry no `id`.
        await expectPipeline(
          source().select(() => ['name']),
          [{ data: { name: 'alice' } }, { data: { name: 'bob' } }, { data: { name: 'carol' } }],
          { ordered: false },
        );
      });

      it('projects multiple fields', async () => {
        await expectPipeline(
          source().select(() => ['name', 'rank']),
          [
            { data: { name: 'alice', rank: 1 } },
            { data: { name: 'bob', rank: 2 } },
            { data: { name: 'carol', rank: 3 } },
          ],
          { ordered: false },
        );
      });

      it('projects a nested (dotted) field, keeping the nested shape', async () => {
        // A dotted path selects the nested value at its original position —
        // `{ profile: { age } }`, not a flat `'profile.age'` key (mirrors
        // `BuildSelectionSchema` / `PathToSchema`).
        await expectPipeline(
          source().select(() => ['profile.age']),
          [
            { data: { profile: { age: 20 } } },
            { data: { profile: { age: 30 } } },
            { data: { profile: { age: 40 } } },
          ],
          { ordered: false },
        );
      });

      it('merges sibling selections under the same parent map', async () => {
        // Two dotted paths sharing a parent deep-merge into one nested map
        // (mirrors `MergeSchemas`). `gender` is optional and absent on a2.
        await expectPipeline(
          source().select(() => ['profile.age', 'profile.gender']),
          [
            { data: { profile: { age: 20, gender: 'female' } } },
            { data: { profile: { age: 30 } } },
            { data: { profile: { age: 40, gender: 'male' } } },
          ],
          { ordered: false },
        );
      });

      it('projects a field expression aliased via `.as()`', async () => {
        await expectPipeline(
          source().select((field) => [field('name').as('authorName')]),
          [
            { data: { authorName: 'alice' } },
            { data: { authorName: 'bob' } },
            { data: { authorName: 'carol' } },
          ],
          { ordered: false },
        );
      });

      it('projects a computed expression aliased via `.as()`', async () => {
        await expectPipeline(
          source().select((field) => ['name', equal(field('rank'), constant(2)).as('isSecond')]),
          [
            { data: { name: 'alice', isSecond: false } },
            { data: { name: 'bob', isSecond: true } },
            { data: { name: 'carol', isSecond: false } },
          ],
          { ordered: false },
        );
      });

      // The three last-wins cases mirror the `BuildSelectionSchema` type tests
      // in `selection.test.ts` — the runtime rows must match what the type
      // computes.

      it('last-wins: the same output name selected twice', async () => {
        // The later aliased expression replaces the earlier field selection.
        await expectPipeline(
          source().select((field) => ['name', field('rank').as('name')]),
          [{ data: { name: 1 } }, { data: { name: 2 } }, { data: { name: 3 } }],
          { ordered: false },
        );
      });

      it('last-wins: a child path after its parent narrows to the child', async () => {
        await expectPipeline(
          source().select(() => ['profile', 'profile.age']),
          [
            { data: { profile: { age: 20 } } },
            { data: { profile: { age: 30 } } },
            { data: { profile: { age: 40 } } },
          ],
          { ordered: false },
        );
      });

      it('last-wins: a parent path after its child selects the full subtree', async () => {
        await expectPipeline(
          source().select(() => ['profile.age', 'profile']),
          [
            { data: { profile: { age: 20, gender: 'female' } } },
            { data: { profile: { age: 30 } } },
            { data: { profile: { age: 40, gender: 'male' } } },
          ],
          { ordered: false },
        );
      });

      it('composes with a subsequent sort over the projected schema', async () => {
        await expectPipeline(
          source()
            .select(() => ['name', 'rank'])
            .sort((field) => [desc(field('rank'))]),
          [
            { data: { name: 'carol', rank: 3 } },
            { data: { name: 'bob', rank: 2 } },
            { data: { name: 'alice', rank: 1 } },
          ],
        );
      });
    });
  });
};
