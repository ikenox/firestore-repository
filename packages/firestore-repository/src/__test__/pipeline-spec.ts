import { assert, beforeEach, describe, expect, it } from 'vitest';

import {
  abs,
  add,
  and,
  collectionId,
  cosineDistance,
  documentId,
  dotProduct,
  euclideanDistance,
  isType,
  like,
  regexContains,
  regexFind,
  regexFindAll,
  regexMatch,
  stringIndexOf,
  stringRepeat,
  stringReplaceAll,
  stringReplaceOne,
  substring,
  type,
  vectorLength,
  byteLength,
  ceil,
  charLength,
  constant,
  divide,
  endsWith,
  equal,
  exp,
  floor,
  geoPointValue,
  vectorValue,
  greaterThan,
  greaterThanOrEqual,
  lessThan,
  lessThanOrEqual,
  ln,
  log10,
  ltrim,
  mod,
  multiply,
  not,
  notEqual,
  or,
  pow,
  rand,
  round,
  rtrim,
  sqrt,
  startsWith,
  stringConcat,
  stringContains,
  stringReverse,
  subtract,
  toLower,
  toUpper,
  trim,
  trunc,
} from '../pipelines/expression.js';
import { asc, desc } from '../pipelines/ordering.js';
import type {
  Pipeline,
  PipelineQueryExecutor,
  PipelineResult,
  PipelineRowIdentity,
} from '../pipelines/pipeline.js';
import {
  collection as collectionInput,
  collectionGroup as collectionGroupInput,
} from '../pipelines/source.js';
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
import {
  type AuthorsCollection,
  authorsCollection,
  type PostsCollection,
  postsCollection,
} from './specification.js';
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

    return { items, source, expectPipeline, collectionName: () => collection.name };
  };

  describe('pipeline specification', () => {
    const { items, source, expectPipeline } = setup();

    describe('input source (no transformation stages)', () => {
      it('fetches all documents of a collection with their ids', async () => {
        // A bare collection input has no defined order, so compare as a set.
        await expectPipeline(source(), items, { ordered: false });
      });
    });

    describe('input stages (subcollection / collection group)', () => {
      // `postsCollection` is a subcollection under `Authors`. `uniqueCollection`
      // renames only the collection itself, so instances land under
      // `Authors/<parent id>/<unique name>` and the group id is unique per run.
      const postItems: [Doc<PostsCollection>, Doc<PostsCollection>, Doc<PostsCollection>] = [
        {
          id: ['author1', 'p1'],
          data: { title: 'first', postedAt: new Date('2024-01-01T00:00:00Z') },
        },
        {
          id: ['author1', 'p2'],
          data: { title: 'second', postedAt: new Date('2024-02-01T00:00:00Z') },
        },
        {
          id: ['author2', 'p3'],
          data: { title: 'third', postedAt: new Date('2024-03-01T00:00:00Z') },
        },
      ];

      let posts: PostsCollection;
      beforeEach(async () => {
        posts = uniqueCollection(postsCollection);
        await createRepository(posts).batchSet(postItems);
      });

      it('reads a specific subcollection instance located by its parent doc ref', async () => {
        // All of author1's posts (and only those); the row ids are full
        // (parent-inclusive) refs.
        await expectPipeline(collectionInput(posts, ['author1']), [postItems[0], postItems[1]], {
          ordered: false,
        });
      });

      it('reads every instance of a subcollection via a collection group', async () => {
        await expectPipeline(collectionGroupInput(posts), postItems, { ordered: false });
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

      it('sorts by the reserved __name__ key (the document id)', async () => {
        // `__name__` stays addressable in `sort` / `where` even though it is
        // not projectable — ids a1 < a2 < a3, so descending reverses them.
        await expectPipeline(
          source().sort((field) => [desc(field('__name__'))]),
          [a3, a2, a1],
        );
      });

      it('keeps rows missing the sort field, ordering them before all values', async () => {
        // Unlike core-query `orderBy` (which EXCLUDES documents lacking the
        // field), pipeline `sort` keeps them: absent orders before every
        // present value (and after `null`) ascending, and mirrored descending.
        // a2 has no `profile.gender`; 'female' (a1) < 'male' (a3).
        await expectPipeline(
          source().sort((field) => [asc(field('profile.gender'))]),
          [a2, a1, a3],
        );
        await expectPipeline(
          source().sort((field) => [desc(field('profile.gender'))]),
          [a3, a1, a2],
        );
      });

      describe('multiple sort keys', () => {
        const compositeCollection = rootCollection({
          name: 'SortComposite',
          schema: { group: string(), n: double() },
        });
        type CompositeDoc = Doc<typeof compositeCollection>;
        const compositeItems: [CompositeDoc, CompositeDoc, CompositeDoc] = [
          { id: ['s1'], data: { group: 'x', n: 1 } },
          { id: ['s2'], data: { group: 'x', n: 2 } },
          { id: ['s3'], data: { group: 'y', n: 3 } },
        ];

        let composite: typeof compositeCollection;
        beforeEach(async () => {
          composite = uniqueCollection(compositeCollection);
          await createRepository(composite).batchSet(compositeItems);
        });

        it('the earlier key takes precedence; later keys break its ties', async () => {
          const [x1, x2, y3] = compositeItems;
          await expectPipeline(
            collectionInput(composite).sort((field) => [asc(field('group')), desc(field('n'))]),
            [x2, x1, y3],
          );
        });
      });
    });

    describe('constant expressions', () => {
      it('projects constants of every supported value type', async () => {
        // One batched round trip verifies inference, translation and decode
        // for the whole ConstantValue domain.
        await expectPipeline(
          source()
            .sort((field) => [asc(field('rank'))])
            .limit(1)
            .addFields(() => [
              constant('text').as('s'),
              constant(2.5).as('n'),
              constant(true).as('b'),
              constant(null).as('z'),
              constant(new Date('2024-01-02T03:04:05.678Z')).as('t'),
              constant(new Uint8Array([1, 2, 3])).as('by'),
              geoPointValue(35.68, 139.69).as('g'),
              vectorValue([0.5, 0.25]).as('v'),
              constant([1, 2, 3]).as('arr'),
              constant([1, 'a', true]).as('mixed'),
              constant({
                x: 1,
                s: 'a',
                inner: { flag: true, blob: new Uint8Array([9, 8]), xs: [1, 2] },
                spot: geoPointValue(1, 3),
              }).as('m'),
            ])
            .select(() => ['s', 'n', 'b', 'z', 't', 'by', 'g', 'v', 'arr', 'mixed', 'm']),
          [
            {
              data: {
                s: 'text',
                n: 2.5,
                b: true,
                z: null,
                t: new Date('2024-01-02T03:04:05.678Z'),
                by: new Uint8Array([1, 2, 3]),
                g: { latitude: 35.68, longitude: 139.69 },
                v: [0.5, 0.25],
                arr: [1, 2, 3],
                mixed: [1, 'a', true],
                m: {
                  x: 1,
                  s: 'a',
                  inner: { flag: true, blob: new Uint8Array([9, 8]), xs: [1, 2] },
                  spot: { latitude: 1, longitude: 3 },
                },
              },
            },
          ],
        );
      });
    });

    // Every expression function gets at least one straightforward live
    // evaluation here — the catalog pins each function's wire translation and
    // its basic backend semantics in one round trip per family. Every future
    // slice MUST add its functions to this catalog.
    describe('function catalog (one straightforward evaluation per function)', () => {
      const { source, expectPipeline, collectionName } = setup();
      /** A single-row source: the catalog evaluates constant expressions only. */
      const one = () => source().limit(1);

      it('arithmetic', async () => {
        await expectPipeline(
          one().select(() => [
            add(constant(1), constant(2)).as('add'),
            subtract(constant(5), constant(3)).as('subtract'),
            multiply(constant(2), constant(3)).as('multiply'),
            divide(constant(7), constant(2.5)).as('divide'),
            mod(constant(7), constant(3)).as('mod'),
            pow(constant(2), constant(3)).as('pow'),
            abs(constant(-5)).as('abs'),
            ceil(constant(1.2)).as('ceil'),
            floor(constant(1.8)).as('floor'),
            round(constant(2.4)).as('round'),
            round(constant(2.44), constant(1)).as('roundTo'),
            trunc(constant(2.9)).as('trunc'),
            trunc(constant(2.99), constant(1)).as('truncTo'),
            sqrt(constant(9)).as('sqrt'),
            exp(constant(0)).as('exp'),
            ln(constant(1)).as('ln'),
            log10(constant(100)).as('log10'),
          ]),
          [
            {
              data: {
                add: 3,
                subtract: 2,
                multiply: 6,
                divide: 2.8,
                mod: 1,
                pow: 8,
                abs: 5,
                ceil: 2,
                floor: 1,
                round: 2,
                roundTo: 2.4,
                trunc: 2,
                truncTo: 2.9,
                sqrt: 3,
                exp: 1,
                ln: 0,
                log10: 2,
              },
            },
          ],
        );
      });

      it('string', async () => {
        await expectPipeline(
          one().select(() => [
            charLength(constant('aあ')).as('charLength'),
            byteLength(constant('aあ')).as('byteLength'),
            toLower(constant('AbC')).as('toLower'),
            toUpper(constant('AbC')).as('toUpper'),
            stringReverse(constant('abc')).as('stringReverse'),
            trim(constant('  pad  ')).as('trim'),
            ltrim(constant('  pad  ')).as('ltrim'),
            rtrim(constant('  pad  ')).as('rtrim'),
            trim(constant('xpadx'), constant('x')).as('trimChars'),
            ltrim(constant('xpadx'), constant('x')).as('ltrimChars'),
            rtrim(constant('xpadx'), constant('x')).as('rtrimChars'),
            startsWith(constant('abc'), constant('a')).as('startsWith'),
            endsWith(constant('abc'), constant('z')).as('endsWith'),
            stringContains(constant('abc'), constant('b')).as('stringContains'),
            stringConcat(constant('a'), constant('b'), constant('c')).as('stringConcat'),
          ]),
          [
            {
              data: {
                charLength: 2,
                byteLength: 4,
                toLower: 'abc',
                toUpper: 'ABC',
                stringReverse: 'cba',
                trim: 'pad',
                ltrim: 'pad  ',
                rtrim: '  pad',
                trimChars: 'pad',
                ltrimChars: 'padx',
                rtrimChars: 'xpad',
                startsWith: true,
                endsWith: false,
                stringContains: true,
                stringConcat: 'abc',
              },
            },
          ],
        );
      });

      it('comparison and logical', async () => {
        await expectPipeline(
          one().select(() => [
            equal(constant(1), constant(1)).as('equal'),
            notEqual(constant(1), constant(1)).as('notEqual'),
            lessThan(constant(1), constant(2)).as('lessThan'),
            lessThanOrEqual(constant(2), constant(2)).as('lessThanOrEqual'),
            greaterThan(constant(1), constant(2)).as('greaterThan'),
            greaterThanOrEqual(constant(2), constant(2)).as('greaterThanOrEqual'),
            and(equal(constant(1), constant(1)), equal(constant(2), constant(2))).as('and'),
            or(equal(constant(1), constant(2)), equal(constant(2), constant(2))).as('or'),
            not(equal(constant(1), constant(2))).as('not'),
          ]),
          [
            {
              data: {
                equal: true,
                notEqual: false,
                lessThan: true,
                lessThanOrEqual: true,
                greaterThan: false,
                greaterThanOrEqual: true,
                and: true,
                or: true,
                not: true,
              },
            },
          ],
        );
      });

      it('string (slice 3) and regex', async () => {
        await expectPipeline(
          one().select(() => [
            stringIndexOf(constant('abc'), constant('b')).as('indexOf'),
            stringIndexOf(constant('abc'), constant('z')).as('indexOfMiss'),
            stringRepeat(constant('ab'), constant(2)).as('repeat'),
            stringReplaceAll(constant('aba'), constant('a'), constant('x')).as('replaceAll'),
            stringReplaceOne(constant('aba'), constant('a'), constant('x')).as('replaceOne'),
            substring(constant('abc'), constant(1)).as('substringToEnd'),
            substring(constant('abc'), constant(1), constant(1)).as('substringLen'),
            like(constant('abc'), constant('a%')).as('like'),
            regexContains(constant('abc'), constant('b+')).as('regexContains'),
            regexMatch(constant('abc'), constant('b+')).as('regexMatchPartial'),
            regexMatch(constant('abc'), constant('a.c')).as('regexMatchFull'),
            regexFind(constant('abc'), constant('b+')).as('regexFind'),
            regexFind(constant('abc'), constant('z+')).as('regexFindMiss'),
            regexFindAll(constant('abc'), constant('[ab]')).as('regexFindAll'),
            regexFindAll(constant('abc'), constant('z+')).as('regexFindAllMiss'),
          ]),
          [
            {
              data: {
                indexOf: 1,
                indexOfMiss: -1,
                repeat: 'abab',
                replaceAll: 'xbx',
                replaceOne: 'xba',
                substringToEnd: 'bc',
                substringLen: 'b',
                like: true,
                regexContains: true,
                regexMatchPartial: false,
                regexMatchFull: true,
                regexFind: 'b',
                regexFindMiss: null,
                regexFindAll: ['a', 'b'],
                regexFindAllMiss: [],
              },
            },
          ],
        );
      });

      it('type / isType and vector', async () => {
        await expectPipeline(
          one().select(() => [
            type(constant('x')).as('typeString'),
            // A whole JS number wire-encodes as an integer — type() observes
            // int64, the honest 'integer' | 'double' tag at work.
            type(constant(7)).as('typeInt'),
            type(constant(7.5)).as('typeDouble'),
            type(constant(null)).as('typeNull'),
            isType(constant('x'), 'string').as('isTypeHit'),
            isType(constant('x'), 'int64').as('isTypeMiss'),
            vectorLength(vectorValue([1, 2, 3])).as('vectorLength'),
            dotProduct(vectorValue([1, 2, 3]), vectorValue([1, 1, 1])).as('dotProduct'),
            euclideanDistance(vectorValue([1, 2]), vectorValue([4, 6])).as('euclidean'),
            cosineDistance(vectorValue([1, 0]), vectorValue([1, 0])).as('cosine'),
          ]),
          [
            {
              data: {
                typeString: 'string',
                typeInt: 'int64',
                typeDouble: 'float64',
                typeNull: 'null',
                isTypeHit: true,
                isTypeMiss: false,
                vectorLength: 3,
                dotProduct: 6,
                euclidean: 5,
                cosine: 0,
              },
            },
          ],
        );
      });

      it('reference: documentId / collectionId over __name__', async () => {
        const sorted = source()
          .sort((field) => [asc(field('rank'))])
          .limit(1);
        await expectPipeline(
          sorted.select((field) => [
            documentId(field('__name__')).as('id'),
            collectionId(field('__name__')).as('cid'),
          ]),
          [{ data: { id: 'a1', cid: collectionName() } }],
        );
      });

      // rand (the remaining nullary) is covered by its own range test below —
      // its value is not deterministic.
    });

    describe('arithmetic and string functions', () => {
      const { source, expectPipeline } = setup();

      it('computes nested arithmetic over fields and constants', async () => {
        await expectPipeline(
          source().select((field) => [
            'name',
            add(multiply(field('rank'), constant(10)), constant(1)).as('score'),
          ]),
          [
            { data: { name: 'alice', score: 11 } },
            { data: { name: 'bob', score: 21 } },
            { data: { name: 'carol', score: 31 } },
          ],
          { ordered: false },
        );
      });

      it('integer division truncates; a double operand makes it a double division', async () => {
        // A whole JS number is wire-encoded as an INTEGER, and
        // integer / integer is a truncating division — the honest
        // 'integer' | 'double' tag on number-valued descriptors at work.
        await expectPipeline(
          source().select((field) => ['name', divide(field('rank'), constant(2)).as('half')]),
          [
            { data: { name: 'alice', half: 0 } },
            { data: { name: 'bob', half: 1 } },
            { data: { name: 'carol', half: 1 } },
          ],
          { ordered: false },
        );
      });

      it('round takes an optional decimal-places operand', async () => {
        await expectPipeline(
          source().select((field) => [
            'name',
            round(divide(field('rank'), constant(2.5)), constant(2)).as('scaled'),
          ]),
          [
            { data: { name: 'alice', scaled: 0.4 } },
            { data: { name: 'bob', scaled: 0.8 } },
            { data: { name: 'carol', scaled: 1.2 } },
          ],
          { ordered: false },
        );
      });

      it('string transforms, lengths, concatenation, and character-set trim', async () => {
        await expectPipeline(
          source().select((field) => [
            stringConcat(toUpper(field('name')), constant('!')).as('shout'),
            charLength(field('name')).as('len'),
            trim(field('name'), constant('al')).as('trimmed'),
          ]),
          [
            { data: { shout: 'ALICE!', len: 5, trimmed: 'ice' } },
            { data: { shout: 'BOB!', len: 3, trimmed: 'bob' } },
            { data: { shout: 'CAROL!', len: 5, trimmed: 'caro' } },
          ],
          { ordered: false },
        );
      });

      it('a string predicate is a valid where condition', async () => {
        const [a1] = items;
        await expectPipeline(
          source().where((field) => startsWith(field('name'), constant('a'))),
          [a1],
        );
      });

      it('null propagation end-to-end: an optional operand yields nullable output', async () => {
        // profile.gender is optional: bob's is absent, and absence flows
        // through functions as null (probed) — the projected schema is
        // nullable(string()) and the row decodes a null VALUE.
        await expectPipeline(
          source().select((field) => ['name', toUpper(field('profile.gender')).as('g')]),
          [
            { data: { name: 'alice', g: 'FEMALE' } },
            { data: { name: 'bob', g: null } },
            { data: { name: 'carol', g: 'MALE' } },
          ],
          { ordered: false },
        );
      });

      it('a null condition drops the row (string predicate over an optional field)', async () => {
        const [, , a3] = items;
        await expectPipeline(
          source().where((field) => startsWith(field('profile.gender'), constant('m'))),
          [a3],
        );
      });

      it('rand produces a double in [0, 1) per row', async () => {
        const results = await executor.execute(source().select(() => [rand().as('r')]));
        expect(results).toHaveLength(3);
        for (const row of results) {
          expect(row.data.r).toBeGreaterThanOrEqual(0);
          expect(row.data.r).toBeLessThan(1);
        }
      });
    });

    describe('limit / offset', () => {
      // items are seeded with rank 1 / 2 / 3 for a1 / a2 / a3; sort first so
      // the truncation point is deterministic.
      const [a1, a2, a3] = items;

      it('limit truncates the sorted rows, keeping row identity', async () => {
        await expectPipeline(
          source()
            .sort((field) => [asc(field('rank'))])
            .limit(2),
          [a1, a2],
        );
      });

      it('offset skips the leading sorted rows', async () => {
        await expectPipeline(
          source()
            .sort((field) => [asc(field('rank'))])
            .offset(1),
          [a2, a3],
        );
      });

      it('offset then limit pages through the rows', async () => {
        await expectPipeline(
          source()
            .sort((field) => [asc(field('rank'))])
            .offset(1)
            .limit(1),
          [a2],
        );
      });

      it('a limit larger than the row count returns everything', async () => {
        await expectPipeline(
          source()
            .sort((field) => [asc(field('rank'))])
            .limit(100),
          [a1, a2, a3],
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

    // Ancestor optionality moves onto the projected leaf: the backend
    // materializes a dotted selection's intermediate layers and omits only the
    // leaf, so a path through an optional map yields an optional leaf (and an
    // aliased read of it an optional key). See
    // docs/pipeline-query-projection-research.md.
    describe('select through an optional map', () => {
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

      it('a dotted path through an optional map yields an optional leaf', async () => {
        await expectPipeline(
          collectionInput(coll).select(() => ['meta.x']),
          [{ data: { meta: { x: 1 } } }, { data: { meta: {} } }],
          { ordered: false },
        );
      });

      it('an alias of a field under an optional map yields an optional key', async () => {
        await expectPipeline(
          collectionInput(coll).select((field) => ['name', field('meta.x').as('mx')]),
          [{ data: { name: 'with-meta', mx: 1 } }, { data: { name: 'without-meta' } }],
          { ordered: false },
        );
      });
    });

    describe('where', () => {
      // items are seeded with rank 1 / 2 / 3 for a1 / a2 / a3.
      const [a1, a2, a3] = items;

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

      it('filters with magnitude comparisons (lessThan / greaterThanOrEqual / ...)', async () => {
        await expectPipeline(
          source().where((field) => greaterThanOrEqual(field('rank'), constant(2))),
          [a2, a3],
          { ordered: false },
        );
      });

      it('combines conditions with and / or', async () => {
        await expectPipeline(
          source().where((field) =>
            and(
              equal(field('profile.gender'), constant('female')),
              lessThan(field('rank'), constant(2)),
            ),
          ),
          [a1],
          { ordered: false },
        );
        await expectPipeline(
          source().where((field) =>
            or(equal(field('rank'), constant(1)), equal(field('rank'), constant(3))),
          ),
          [a1, a3],
          { ordered: false },
        );
      });

      it('negates conditions with not / notEqual', async () => {
        await expectPipeline(
          source().where((field) => not(equal(field('rank'), constant(2)))),
          [a1, a3],
          { ordered: false },
        );
        await expectPipeline(
          source().where((field) => notEqual(field('rank'), constant(2))),
          [a1, a3],
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
