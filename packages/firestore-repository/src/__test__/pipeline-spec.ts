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
import {
  type Collection,
  type DocumentSchema,
  double,
  map,
  optional,
  rootCollection,
  string,
} from '../schema.js';
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

      it('projects a field expression bound to an alias', async () => {
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

      it('projects a computed expression bound to an alias', async () => {
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

    // TODO(#202): un-skip once ancestor optionality propagates to the selected
    // leaf. Selecting through an optional map currently types the leaf as
    // required, but the backend materializes the intermediate layers and omits
    // only the leaf (`{ meta: {} }` for a doc without `meta`) — so decoding
    // real data throws (confirmed live: both tests fail with a ZodError when
    // un-skipped). The `@ts-expect-error`s below mark expectations the current
    // (wrong) types reject; the fix will turn them into unused directives,
    // forcing this suite to be revisited.
    describe('select through an optional map (#202)', () => {
      const optionalMetaCollection = rootCollection({
        name: 'OptionalMeta',
        schema: { name: string(), meta: optional(map({ x: double() })) },
      });

      let coll: typeof optionalMetaCollection;
      beforeEach(async () => {
        coll = uniqueCollection(optionalMetaCollection);
        await createRepository(coll).batchSet([
          { id: ['m1'], data: { name: 'with-meta', meta: { x: 1 } } },
          { id: ['m2'], data: { name: 'without-meta' } },
        ]);
      });

      it.skip('a dotted path through an optional map yields an optional leaf', async () => {
        await expectPipeline(
          collectionInput(coll).select(() => ['meta.x']),
          [
            { data: { meta: { x: 1 } } },
            // @ts-expect-error -- #202: the leaf must become optional; the backend returns `{ meta: {} }` here
            { data: { meta: {} } },
          ],
          { ordered: false },
        );
      });

      it.skip('an alias of a field under an optional map yields an optional key', async () => {
        await expectPipeline(
          collectionInput(coll).select((field) => ['name', field('meta.x').as('mx')]),
          [
            { data: { name: 'with-meta', mx: 1 } },
            // @ts-expect-error -- #202: `mx` must become optional; the backend omits the key here
            { data: { name: 'without-meta' } },
          ],
          { ordered: false },
        );
      });
    });

    describe('where', () => {
      // items are seeded with rank 1 / 2 / 3 for a1 / a2 / a3.
      const [a1, _a2, a3] = items;

      it('filters rows by an equality condition, keeping row identity', async () => {
        await expectPipeline(
          source().where((field) => equal(field('rank'), constant(1))),
          [a1],
          { ordered: false },
        );
      });

      it('filters by a nested (dotted) field', async () => {
        await expectPipeline(
          source().where((field) => equal(field('profile.age'), constant(40))),
          [a3],
          { ordered: false },
        );
      });

      it('silently drops rows where the condition does not evaluate to true', async () => {
        // a2 has no `profile.gender`, so the comparison does not evaluate to
        // `true` for it — the row is dropped rather than erroring (Firestore's
        // truthy-only `where` semantics; mixed/missing fields are tolerated).
        await expectPipeline(
          source().where((field) => equal(field('profile.gender'), constant('male'))),
          [a3],
          { ordered: false },
        );
      });

      it('chained where stages conjoin (AND)', async () => {
        // Each condition matches a row on its own (gender=female -> a1,
        // rank=3 -> a3), but no row satisfies both — a disjunction would
        // return two rows, a conjunction none.
        await expectPipeline(
          source()
            .where((field) => equal(field('profile.gender'), constant('female')))
            .where((field) => equal(field('rank'), constant(3))),
          [],
          { ordered: false },
        );

        // A row satisfying both conditions passes through the chain.
        await expectPipeline(
          source()
            .where((field) => equal(field('profile.gender'), constant('male')))
            .where((field) => equal(field('rank'), constant(3))),
          [a3],
          { ordered: false },
        );
      });

      it('composes with a subsequent select over the filtered rows', async () => {
        await expectPipeline(
          source()
            .where((field) => equal(field('rank'), constant(2)))
            .select(() => ['name']),
          [{ data: { name: 'bob' } }],
          { ordered: false },
        );
      });
    });

    describe('removeFields', () => {
      it('removes a top-level field, keeping row identity', async () => {
        // `removeFields` is identity-preserving: rows keep their `id`.
        await expectPipeline(
          source().removeFields('rank'),
          [
            {
              id: ['a1'],
              data: { name: 'alice', profile: { age: 20, gender: 'female' }, tag: ['x'] },
            },
            { id: ['a2'], data: { name: 'bob', profile: { age: 30 }, tag: [] } },
            {
              id: ['a3'],
              data: { name: 'carol', profile: { age: 40, gender: 'male' }, tag: ['y', 'z'] },
            },
          ],
          { ordered: false },
        );
      });

      it('removes a nested (dotted) field', async () => {
        // Removing an optional field that is absent on a document (a2's
        // `gender`) is a no-op for that document.
        await expectPipeline(
          source().removeFields('profile.gender'),
          [
            { id: ['a1'], data: { name: 'alice', profile: { age: 20 }, rank: 1, tag: ['x'] } },
            { id: ['a2'], data: { name: 'bob', profile: { age: 30 }, rank: 2, tag: [] } },
            { id: ['a3'], data: { name: 'carol', profile: { age: 40 }, rank: 3, tag: ['y', 'z'] } },
          ],
          { ordered: false },
        );
      });

      it('removes multiple fields at once', async () => {
        await expectPipeline(
          source().removeFields('rank', 'tag', 'profile.gender'),
          [
            { id: ['a1'], data: { name: 'alice', profile: { age: 20 } } },
            { id: ['a2'], data: { name: 'bob', profile: { age: 30 } } },
            { id: ['a3'], data: { name: 'carol', profile: { age: 40 } } },
          ],
          { ordered: false },
        );
      });

      it('drops a map emptied by removing all of its fields', async () => {
        // Mirrors `OmitPaths`' empty-map cascade: removing every field of
        // `profile` drops the `profile` key from the schema itself.
        await expectPipeline(
          source().removeFields('profile.age', 'profile.gender'),
          [
            { id: ['a1'], data: { name: 'alice', rank: 1, tag: ['x'] } },
            { id: ['a2'], data: { name: 'bob', rank: 2, tag: [] } },
            { id: ['a3'], data: { name: 'carol', rank: 3, tag: ['y', 'z'] } },
          ],
          { ordered: false },
        );
      });

      it('composes with a subsequent sort over the narrowed schema', async () => {
        await expectPipeline(
          source()
            .removeFields('profile', 'tag')
            .sort((field) => [desc(field('rank'))]),
          [
            { id: ['a3'], data: { name: 'carol', rank: 3 } },
            { id: ['a2'], data: { name: 'bob', rank: 2 } },
            { id: ['a1'], data: { name: 'alice', rank: 1 } },
          ],
        );
      });
    });

    describe('addFields', () => {
      it('adds an aliased computed field, keeping identity and existing fields', async () => {
        // `addFields` is identity-preserving and keeps every existing field.
        await expectPipeline(
          source()
            .removeFields('profile', 'tag') // narrow the rows to keep the expectations readable
            .addFields((field) => [equal(field('rank'), constant(2)).as('isSecond')]),
          [
            { id: ['a1'], data: { name: 'alice', rank: 1, isSecond: false } },
            { id: ['a2'], data: { name: 'bob', rank: 2, isSecond: true } },
            { id: ['a3'], data: { name: 'carol', rank: 3, isSecond: false } },
          ],
          { ordered: false },
        );
      });

      it('deep-merges a dotted alias into an existing map', async () => {
        // Adding under an existing map merges with its fields (verified against
        // the backend), mirroring `MergeSchemas`.
        await expectPipeline(
          source()
            .removeFields('rank', 'tag')
            .addFields((field) => [field('name').as('profile.author')]),
          [
            {
              id: ['a1'],
              data: { name: 'alice', profile: { age: 20, gender: 'female', author: 'alice' } },
            },
            { id: ['a2'], data: { name: 'bob', profile: { age: 30, author: 'bob' } } },
            {
              id: ['a3'],
              data: { name: 'carol', profile: { age: 40, gender: 'male', author: 'carol' } },
            },
          ],
          { ordered: false },
        );
      });

      it('an added field overwrites an existing one on name overlap', async () => {
        // The added field wins (the SDK's "overwrite existing ones" behavior);
        // `rank` becomes a string here, which `BuildAddFieldsSchema` tracks.
        await expectPipeline(
          source()
            .removeFields('profile', 'tag')
            .addFields((field) => [field('name').as('rank')]),
          [
            { id: ['a1'], data: { name: 'alice', rank: 'alice' } },
            { id: ['a2'], data: { name: 'bob', rank: 'bob' } },
            { id: ['a3'], data: { name: 'carol', rank: 'carol' } },
          ],
          { ordered: false },
        );
      });

      it('a subsequent select projects an added field', async () => {
        // The added field participates in the reshaped schema: `select` can
        // reference it by path, and the rows decode with it.
        await expectPipeline(
          source()
            .addFields((field) => [equal(field('rank'), constant(2)).as('isSecond')])
            .select(() => ['name', 'isSecond']),
          [
            { data: { name: 'alice', isSecond: false } },
            { data: { name: 'bob', isSecond: true } },
            { data: { name: 'carol', isSecond: false } },
          ],
          { ordered: false },
        );
      });

      it('a subsequent select projects a field deep-merged into an existing map', async () => {
        await expectPipeline(
          source()
            .addFields((field) => [field('name').as('profile.author')])
            .select(() => ['profile.author']),
          [
            { data: { profile: { author: 'alice' } } },
            { data: { profile: { author: 'bob' } } },
            { data: { profile: { author: 'carol' } } },
          ],
          { ordered: false },
        );
      });

      it('a subsequent select sees the overwritten field type', async () => {
        // `rank` was overwritten by a string-typed field; the projected rows
        // (and their static type) carry the string.
        await expectPipeline(
          source()
            .addFields((field) => [field('name').as('rank')])
            .select(() => ['rank']),
          [{ data: { rank: 'alice' } }, { data: { rank: 'bob' } }, { data: { rank: 'carol' } }],
          { ordered: false },
        );
      });

      it('composes with a subsequent sort over the added field', async () => {
        await expectPipeline(
          source()
            .removeFields('profile', 'tag')
            .addFields((field) => [field('rank').as('score')])
            .sort((field) => [desc(field('score'))]),
          [
            { id: ['a3'], data: { name: 'carol', rank: 3, score: 3 } },
            { id: ['a2'], data: { name: 'bob', rank: 2, score: 2 } },
            { id: ['a1'], data: { name: 'alice', rank: 1, score: 1 } },
          ],
        );
      });
    });
  });
};
