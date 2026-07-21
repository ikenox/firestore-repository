import { assert, beforeEach, describe, expect, it } from 'vitest';

import { refPath } from '../path.js';
import {
  abs,
  add,
  and,
  arrayAgg,
  arrayConcat,
  arrayContains,
  arrayContainsAll,
  arrayContainsAny,
  arrayGet,
  arrayLength,
  arrayReverse,
  arrayValue,
  average,
  byteLength,
  ceil,
  charLength,
  collectionId,
  conditional,
  constant,
  cosineDistance,
  count,
  countAll,
  countDistinct,
  countIf,
  currentTimestamp,
  divide,
  docRefValue,
  documentId,
  dotProduct,
  endsWith,
  equal,
  equalAny,
  euclideanDistance,
  exists,
  exp,
  type Expression,
  field,
  first,
  floor,
  geoPointValue,
  greaterThan,
  greaterThanOrEqual,
  ifAbsent,
  ifError,
  ifNull,
  isAbsent,
  isError,
  isType,
  last,
  lessThan,
  lessThanOrEqual,
  like,
  ln,
  log10,
  logicalMaximum,
  logicalMinimum,
  ltrim,
  maximum,
  minimum,
  mapEntries,
  mapGet,
  mapKeys,
  mapMerge,
  mapRemove,
  mapSet,
  mapValue,
  mapValues,
  mod,
  multiply,
  not,
  notEqual,
  notEqualAny,
  or,
  pow,
  rand,
  regexContains,
  regexFind,
  regexFindAll,
  regexMatch,
  round,
  rtrim,
  sqrt,
  startsWith,
  stringConcat,
  stringContains,
  stringIndexOf,
  stringRepeat,
  stringReplaceAll,
  stringReplaceOne,
  stringReverse,
  substring,
  subtract,
  sum,
  timestampAdd,
  timestampDiff,
  timestampExtract,
  timestampSubtract,
  timestampToUnixMicros,
  timestampToUnixMillis,
  timestampToUnixSeconds,
  timestampTruncate,
  toLower,
  toUpper,
  trim,
  trunc,
  type,
  unixMicrosToTimestamp,
  unixMillisToTimestamp,
  unixSecondsToTimestamp,
  vectorLength,
  vectorValue,
  xor,
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
  array,
  double,
  int64,
  map,
  nullable,
  optional,
  rootCollection,
  string,
  type Collection,
  type DocumentSchema,
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

  /**
   * Executes `pipeline` (however sourced) and asserts the result rows
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

  const setup = () => {
    let collection: AuthorsCollection;
    beforeEach(async () => {
      collection = uniqueCollection(authorsCollection);
      await createRepository(collection).batchSet(items);
    });

    /** The input stage (`collection(...)`) for the seeded collection. */
    const source = (): Pipeline<AuthorsCollection['schema'], DocRef<AuthorsCollection>> =>
      collectionInput(collection);

    return {
      items,
      source,
      collectionName: () => collection.name,
      liveCollection: () => collection,
    };
  };

  describe('pipeline specification', () => {
    const { items, source } = setup();

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
              constant(geoPointValue(35.68, 139.69)).as('g'),
              constant(vectorValue([0.5, 0.25])).as('v'),
              constant([1, 2, 3]).as('arr'),
              constant([1, 'a', true]).as('mixed'),
              constant({
                x: 1,
                s: 'a',
                inner: { flag: true, blob: new Uint8Array([9, 8]), xs: [1, 2] },
                spot: geoPointValue(1, 3),
              }).as('m'),
              constant(docRefValue(['SomeCollection', 'x1'])).as('ref'),
              constant([1, null]).as('arrNull'),
              constant({ a: null }).as('mNull'),
              constant([vectorValue([1]), vectorValue([2])]).as('vecs'),
              constant([docRefValue(['SomeCollection', 'x2'])]).as('refs'),
              constant({}).as('emptyMap'),
            ])
            .select(() => [
              's',
              'n',
              'b',
              'z',
              't',
              'by',
              'g',
              'v',
              'arr',
              'mixed',
              'm',
              'ref',
              'arrNull',
              'mNull',
              'vecs',
              'refs',
              'emptyMap',
            ]),
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
                ref: ['SomeCollection', 'x1'],
                arrNull: [1, null],
                mNull: { a: null },
                vecs: [[1], [2]],
                refs: [['SomeCollection', 'x2']],
                emptyMap: {},
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
      const { items, source, collectionName, liveCollection } = setup();
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
            vectorLength(constant(vectorValue([1, 2, 3]))).as('vectorLength'),
            dotProduct(constant(vectorValue([1, 2, 3])), constant(vectorValue([1, 1, 1]))).as(
              'dotProduct',
            ),
            euclideanDistance(constant(vectorValue([1, 2])), constant(vectorValue([4, 6]))).as(
              'euclidean',
            ),
            cosineDistance(constant(vectorValue([1, 0])), constant(vectorValue([1, 0]))).as(
              'cosine',
            ),
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

      it('reference: __name__ equals a docRefValue constant (never a string)', async () => {
        const [a1] = items;
        // Probed: the pipeline backend never matches __name__ against any
        // string form (id / relative path / full resource path) — only a
        // genuine reference value.
        await expectPipeline(
          source().where((field) =>
            equal(field('__name__'), constant(docRefValue(refPath(liveCollection(), ['a1'])))),
          ),
          [a1],
        );
      });

      it('reference: a projected raw __name__ decodes to its segment path', async () => {
        await expectPipeline(
          source()
            .sort((field) => [asc(field('rank'))])
            .limit(1)
            .select((field) => [field('__name__').as('key'), 'name']),
          [{ data: { key: [collectionName(), 'a1'], name: 'alice' } }],
        );
      });

      it('reference: a docRefValue inside a constant map decodes to a RefPath', async () => {
        await expectPipeline(
          one().select(() => [
            constant({ author: docRefValue(refPath(liveCollection(), ['a2'])) }).as('m'),
          ]),
          [{ data: { m: { author: [collectionName(), 'a2'] } } }],
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

      it('timestamp', async () => {
        const base = new Date('2024-03-15T10:30:45.123Z');
        const later = new Date('2024-03-18T01:00:00Z');
        await expectPipeline(
          one().select(() => [
            timestampAdd(constant(base), 'day', constant(1)).as('add'),
            timestampSubtract(constant(base), 'hour', constant(2)).as('subtract'),
            timestampToUnixSeconds(constant(base)).as('toSecs'),
            timestampToUnixMillis(constant(base)).as('toMillis'),
            timestampToUnixMicros(constant(base)).as('toMicros'),
            unixSecondsToTimestamp(constant(1710498645)).as('fromSecs'),
            unixMillisToTimestamp(constant(1710498645123)).as('fromMillis'),
            unixMicrosToTimestamp(constant(1710498645123000)).as('fromMicros'),
            timestampTruncate(constant(base), 'month').as('truncMonth'),
            // bare 'week' starts on Sunday; 'week(monday)' picks the start day
            timestampTruncate(constant(base), 'week').as('truncWeek'),
            timestampTruncate(constant(base), 'week(monday)').as('truncWeekMon'),
            timestampTruncate(constant(base), 'day', 'Asia/Tokyo').as('truncDayTokyo'),
            timestampExtract(constant(base), 'year').as('extractYear'),
            // 1-based from Sunday: 2024-03-15 is a Friday
            timestampExtract(constant(base), 'dayofweek').as('extractDow'),
            timestampExtract(constant(base), 'hour', 'Asia/Tokyo').as('extractHourTokyo'),
            // end - start in whole units, truncated toward zero (2.6 days -> 2)
            timestampDiff(constant(later), constant(base), 'day').as('diffDays'),
            timestampDiff(constant(base), constant(later), 'hour').as('diffHoursNeg'),
          ]),
          [
            {
              data: {
                add: new Date('2024-03-16T10:30:45.123Z'),
                subtract: new Date('2024-03-15T08:30:45.123Z'),
                toSecs: 1710498645,
                toMillis: 1710498645123,
                toMicros: 1710498645123000,
                fromSecs: new Date('2024-03-15T10:30:45.000Z'),
                fromMillis: new Date('2024-03-15T10:30:45.123Z'),
                fromMicros: new Date('2024-03-15T10:30:45.123Z'),
                truncMonth: new Date('2024-03-01T00:00:00Z'),
                truncWeek: new Date('2024-03-10T00:00:00Z'),
                truncWeekMon: new Date('2024-03-11T00:00:00Z'),
                truncDayTokyo: new Date('2024-03-14T15:00:00Z'),
                extractYear: 2024,
                extractDow: 6,
                extractHourTokyo: 19,
                diffDays: 2,
                diffHoursNeg: -62,
              },
            },
          ],
        );
      });

      it('existence, error channel, conditional, logical extremes, any-of (slice 5)', async () => {
        // Deterministic single row: a1 (rank 1, name 'alice', gender 'female').
        const first = source()
          .sort((field) => [asc(field('rank'))])
          .limit(1);
        await expectPipeline(
          first.select((field) => [
            exists(field('name')).as('exists'),
            exists(field('profile.gender')).as('existsOptional'),
            isAbsent(field('profile.gender')).as('isAbsentOptional'),
            isError(divide(constant(1), constant(0))).as('isError'),
            isError(constant(1)).as('isErrorFalse'),
            ifError(divide(constant(1), constant(0)), constant(-1)).as('ifErrorCaught'),
            ifError(constant(7), constant(-1)).as('ifErrorPassed'),
            ifAbsent(field('profile.gender'), constant('unknown')).as('ifAbsent'),
            ifNull(constant(null), constant('dflt')).as('ifNull'),
            ifNull(constant('present'), constant('dflt')).as('ifNullPassed'),
            conditional(
              greaterThan(field('rank'), constant(1)),
              constant('big'),
              constant('small'),
            ).as('cond'),
            logicalMaximum(constant(1), constant('a')).as('logMaxCrossType'),
            logicalMinimum(field('rank'), constant(2)).as('logMin'),
            equalAny(field('rank'), constant([1, 5, 9])).as('equalAny'),
            notEqualAny(field('rank'), constant([1, 5, 9])).as('notEqualAny'),
            xor(constant(true), constant(true), constant(true)).as('xor'),
          ]),
          [
            {
              data: {
                exists: true,
                existsOptional: true,
                isAbsentOptional: false,
                isError: true,
                isErrorFalse: false,
                ifErrorCaught: -1,
                ifErrorPassed: 7,
                ifAbsent: 'female',
                ifNull: 'dflt',
                ifNullPassed: 'present',
                cond: 'small',
                logMaxCrossType: 'a',
                logMin: 1,
                equalAny: true,
                notEqualAny: false,
                xor: true,
              },
            },
          ],
        );
      });

      it('array and map functions (slice 6)', async () => {
        // Deterministic single row: a1 (rank 1, name 'alice', tag ['x']).
        const first = source()
          .sort((field) => [asc(field('rank'))])
          .limit(1);
        await expectPipeline(
          first.select((field) => [
            arrayValue([field('rank'), constant(9)]).as('arrayValue'),
            arrayLength(field('tag')).as('arrayLength'),
            arrayReverse(constant([1, 2, 3])).as('arrayReverse'),
            arrayGet(constant(['a', 'b', 'c']), constant(1)).as('arrayGet'),
            arrayGet(constant(['a']), constant(-1)).as('arrayGetNegative'),
            arrayContains(field('tag'), constant('x')).as('arrayContains'),
            arrayContainsAll(constant([1, 2, 3]), constant([1, 3])).as('arrayContainsAll'),
            arrayContainsAny(constant([1, 2, 3]), constant([9, 3])).as('arrayContainsAny'),
            arrayConcat(constant([1]), constant([2, 3])).as('arrayConcat'),
            mapValue({ a: field('rank'), b: constant('x') }).as('mapValue'),
            mapGet(mapValue({ a: constant(7) }), 'a').as('mapGet'),
            mapSet(mapValue({ a: constant(1) }), 'b', constant(2)).as('mapSet'),
            mapRemove(mapValue({ a: constant(1), b: constant(2) }), 'a').as('mapRemove'),
            mapMerge(mapValue({ a: constant(1) }), mapValue({ a: constant(9), b: constant(2) })).as(
              'mapMerge',
            ),
            mapKeys(mapValue({ a: constant(1), b: constant(2) })).as('mapKeys'),
            mapValues(mapValue({ a: constant(1), b: constant(2) })).as('mapValues'),
            mapEntries(mapValue({ a: constant(1) })).as('mapEntries'),
          ]),
          [
            {
              data: {
                arrayValue: [1, 9],
                arrayLength: 1,
                arrayReverse: [3, 2, 1],
                arrayGet: 'b',
                arrayGetNegative: 'a',
                arrayContains: true,
                arrayContainsAll: true,
                arrayContainsAny: true,
                arrayConcat: [1, 2, 3],
                mapValue: { a: 1, b: 'x' },
                mapGet: 7,
                mapSet: { a: 1, b: 2 },
                mapRemove: { b: 2 },
                mapMerge: { a: 9, b: 2 },
                mapKeys: ['a', 'b'],
                mapValues: [1, 2],
                mapEntries: [{ k: 'a', v: 1 }],
              },
            },
          ],
        );
      });

      it('direct literal operands evaluate like their constant() forms', async () => {
        // Raw operands lift internally via constant() — so these evaluate
        // exactly as the explicit-constant catalog cases above.
        // Deterministic single row: a1 (rank 1, name 'alice').
        const first = source()
          .sort((field) => [asc(field('rank'))])
          .limit(1);
        await expectPipeline(
          first.select((field) => [
            equal(field('rank'), 1).as('equal'),
            startsWith(field('name'), 'a').as('startsWith'),
            equalAny(field('rank'), [1, 5, 9]).as('equalAny'),
            add(field('rank'), 1).as('add'),
            conditional(greaterThan(field('rank'), 1), 'big', 'small').as('conditional'),
            arrayValue([1, field('rank')]).as('arrayValue'),
          ]),
          [
            {
              data: {
                equal: true,
                startsWith: true,
                equalAny: true,
                add: 2,
                conditional: 'small',
                arrayValue: [1, 1],
              },
            },
          ],
        );
      });

      it('numeric constants wire-encode whole values as integers (the honest widening)', async () => {
        // A number constant is DECLARED DoubleType, but a whole JS number
        // wire-encodes as an integer — so the backend kind here is int64
        // while the descriptor claim is double. This is the one deliberate
        // claim/kind divergence (the honest 'integer' | 'double' tag makes
        // it sound); field operands are oracle-tested exhaustively in the
        // dedicated numeric-kinds suite below.
        await expectPipeline(
          one().select(() => [
            type(add(constant(2), constant(3))).as('wholeConstants'),
            type(add(constant(2), constant(0.5))).as('fractionalConstant'),
          ]),
          [{ data: { wholeConstants: 'int64', fractionalConstant: 'float64' } }],
        );
      });

      it('currentTimestamp is the server time at evaluation', async () => {
        const before = Date.now();
        const results = await executor.execute(one().select(() => [currentTimestamp().as('now')]));
        const after = Date.now();
        const times = results.map((row) => row.data.now.getTime());
        expect(times).toHaveLength(1);
        for (const now of times) {
          // generous clock-skew allowance — this asserts "server time", not precision
          expect(now).toBeGreaterThanOrEqual(before - 60_000);
          expect(now).toBeLessThanOrEqual(after + 60_000);
        }
      });

      // rand (the remaining nullary) is covered by its own range test below —
      // its value is not deterministic.
    });

    describe('numeric result kinds (slice 7): the descriptor claim IS the oracle', () => {
      const numericKindsCollection = rootCollection({
        name: 'NumericKinds',
        schema: { i: int64(), d: double() },
      });
      let numbers: typeof numericKindsCollection;
      beforeEach(async () => {
        numbers = uniqueCollection(numericKindsCollection);
        // d holds a FRACTIONAL value: a whole value in a double() field would
        // wire-encode as an integer and the field's kind would not exercise
        // the double side (the honest tag).
        await createRepository(numbers).batchSet([{ id: ['n1'], data: { i: 7, d: 2.5 } }]);
      });

      it('matches the backend kind for every arithmetic function and operand mix', async () => {
        const i = field(int64(), 'i');
        const d = field(double(), 'd');
        const cases: [string, Expression][] = [];
        const binary = [
          ['add', add],
          ['subtract', subtract],
          ['multiply', multiply],
          ['divide', divide],
          ['mod', mod],
          ['pow', pow],
        ] as const;
        for (const [name, fn] of binary) {
          cases.push([`${name}_ii`, fn(i, i)], [`${name}_id`, fn(i, d)], [`${name}_dd`, fn(d, d)]);
        }
        const unary = [
          ['abs', abs],
          ['ceil', ceil],
          ['floor', floor],
          ['sqrt', sqrt],
          ['exp', exp],
          ['ln', ln],
          ['log10', log10],
        ] as const;
        for (const [name, fn] of unary) {
          cases.push([`${name}_i`, fn(i)], [`${name}_d`, fn(d)]);
        }
        // round/trunc are overloaded (dual-arity) — exercised individually,
        // including the decimal-places forms.
        cases.push(
          ['round_i', round(i)],
          ['round_d', round(d)],
          ['round_i_places', round(i, i)],
          ['round_d_places', round(d, i)],
          ['trunc_i', trunc(i)],
          ['trunc_d', trunc(d)],
          ['trunc_i_places', trunc(i, i)],
          ['trunc_d_places', trunc(d, i)],
        );

        // The ORACLE: each expression's own descriptor claim, mapped to the
        // backend's kind vocabulary. Any divergence between the library's
        // typing and the backend fails this test.
        const expected = Object.fromEntries(
          cases.map(([alias, e]) => [alias, e.type.type === 'int64' ? 'int64' : 'float64']),
        );
        const [head, ...rest] = cases;
        if (head === undefined) {
          throw new Error('no cases');
        }
        const results = await executor.execute(
          collectionInput(numbers).select(() => [
            type(head[1]).as(head[0]),
            ...rest.map(([alias, e]) => type(e).as(alias)),
          ]),
        );
        expect(results.map((row) => row.data)).toStrictEqual([expected]);
      });
    });

    describe('arithmetic and string functions', () => {
      const { source } = setup();

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

      it('projects an UNALIASED field expression exactly like the bare path', async () => {
        // A `Field` is its own alias (its path IS the output name — the SDK's
        // `Selectable` model), so `field('profile.age')` needs no `.as(...)`
        // and lands at the same nested position the string `'profile.age'`
        // does. The rows below are byte-identical to the dotted-path case above.
        await expectPipeline(
          source().select((field) => [field('name'), field('profile.age')]),
          [
            { data: { name: 'alice', profile: { age: 20 } } },
            { data: { name: 'bob', profile: { age: 30 } } },
            { data: { name: 'carol', profile: { age: 40 } } },
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

    // The `aggregate` stage, seeded to reproduce the probe matrix in
    // docs/pipeline-query-aggregate-research.md. Oracles are hand-written FROM
    // that doc. `aggregate` breaks read-identity, so the rows carry no `id`.
    describe('aggregate', () => {
      // `g` is the group key: it holds a value, `null`, OR is absent — so that
      // the null-key and absent-key docs can be shown merging into one `null`
      // group (hence `optional(nullable(...))`). `m` exercises count(expr) /
      // average denominators over null + absent.
      const aggregateCollection = rootCollection({
        name: 'Aggregate',
        schema: { g: optional(nullable(string())), n: int64(), m: optional(nullable(int64())) },
      });
      type AggregateDoc = Doc<typeof aggregateCollection>;
      const aggregateItems: AggregateDoc[] = [
        { id: ['d1'], data: { g: 'x', n: 1, m: 5 } },
        { id: ['d2'], data: { g: 'x', n: 2, m: 7 } },
        { id: ['d3'], data: { g: 'y', n: 4, m: null } }, // m null
        { id: ['d4'], data: { g: null, n: 0, m: 6 } }, // g null; n places it FIRST under sort
        { id: ['d5'], data: { n: 20 } }, // g absent, m absent
      ];

      let coll: typeof aggregateCollection;
      let emptyColl: typeof aggregateCollection;
      beforeEach(async () => {
        coll = uniqueCollection(aggregateCollection);
        await createRepository(coll).batchSet(aggregateItems);
        // A separate collection left unseeded — the empty-input cases.
        emptyColl = uniqueCollection(aggregateCollection);
      });
      const src = () => collectionInput(coll);

      it('groups by a bare path; null and absent keys merge into one null group', async () => {
        // d4 (g=null) and d5 (g absent) collapse into ONE group whose key reads
        // back as `null` (not absent) — the "absent merges into null" rule for
        // grouping. sum ignores nothing here (all n present); countAll counts rows.
        await expectPipeline(
          src().aggregate((field) => ({
            accumulators: [sum(field('n')).as('s'), countAll().as('c')],
            groups: ['g'],
          })),
          [
            { data: { g: 'x', s: 3, c: 2 } },
            { data: { g: 'y', s: 4, c: 1 } },
            { data: { g: null, s: 20, c: 2 } },
          ],
          { ordered: false },
        );
      });

      it('groups by an aliased expression (the computed key is projected)', async () => {
        // greaterThan(n, 5): d1/d2/d3/d4 → false, d5 → true.
        await expectPipeline(
          src().aggregate((field) => ({
            accumulators: [countAll().as('c')],
            groups: [greaterThan(field('n'), constant(5)).as('big')],
          })),
          [{ data: { big: false, c: 4 } }, { data: { big: true, c: 1 } }],
          { ordered: false },
        );
      });

      it('no groups: one whole-input row (null excluded from count(expr) and the average denominator)', async () => {
        // countAll counts all 5 rows; count(m) counts only the 3 non-null,
        // present m values (d3 null, d5 absent excluded); average(m) divides by
        // that same non-null count (18 / 3 = 6), not by 5.
        await expectPipeline(
          src().aggregate((field) => ({
            accumulators: [
              sum(field('n')).as('sumN'),
              countAll().as('countAll'),
              count(field('m')).as('countM'),
              average(field('m')).as('avgM'),
              minimum(field('n')).as('minN'),
              maximum(field('n')).as('maxN'),
            ],
          })),
          [{ data: { sumN: 27, countAll: 5, countM: 3, avgM: 6, minN: 0, maxN: 20 } }],
        );
      });

      it('empty input WITH groups yields zero rows', async () => {
        await expectPipeline(
          collectionInput(emptyColl).aggregate(() => ({
            accumulators: [countAll().as('c')],
            groups: ['g'],
          })),
          [],
        );
      });

      it('empty input WITHOUT groups yields one row with the empty values (sum/average null, countAll 0)', async () => {
        // The whole-input group always emits one row; sum and average are NULL
        // over an empty group (NOT 0, unlike SQL), while countAll is 0.
        await expectPipeline(
          collectionInput(emptyColl).aggregate((field) => ({
            accumulators: [
              sum(field('n')).as('s'),
              countAll().as('c'),
              average(field('n')).as('a'),
            ],
          })),
          [{ data: { s: null, c: 0, a: null } }],
        );
      });

      it('countDistinct / countIf over the whole input', async () => {
        // countDistinct(g): distinct non-null values {x, y} → 2.
        // countIf(n > 5): d5 only → 1.
        await expectPipeline(
          src().aggregate((field) => ({
            accumulators: [
              countDistinct(field('g')).as('distinctG'),
              countIf(greaterThan(field('n'), constant(5))).as('bigN'),
            ],
          })),
          [{ data: { distinctG: 2, bigN: 1 } }],
        );
      });

      it('arrayAgg keeps null values as elements but skips absent ones', async () => {
        // g over the five docs: 'x','x','y', null (d4), absent (d5). arrayAgg
        // KEEPS the null but SKIPS the absent → a 4-element bag. Its order is
        // backend-determined without a sort, so compare as a multiset.
        const results = await executor.execute(
          src().aggregate((field) => ({ accumulators: [arrayAgg(field('g')).as('vals')] })),
        );
        expect(results).toHaveLength(1);
        const [row] = results;
        assert(row !== undefined);
        assert.sameDeepMembers(row.data.vals, ['x', 'x', 'y', null]);
      });

      it('first / last are positional: a null value and an absent (merged-to-null) value are KEPT', async () => {
        // Sorted by n asc: d4(g null), d1(g x), d2(g x), d3(g y), d5(g absent).
        // DISCRIMINATING at both ends (probed the same way —
        // .ikenox/probe-first-last.mjs): if first SKIPPED nulls it would
        // return d1's 'x'; if last skipped absent it would return d3's 'y'.
        // Both return null instead: null is kept, absent merges into null.
        await expectPipeline(
          src()
            .sort((field) => [asc(field('n'))])
            .aggregate((field) => ({
              accumulators: [first(field('g')).as('first'), last(field('g')).as('last')],
            })),
          [{ data: { first: null, last: null } }],
        );
      });

      it('an optional group key round-trips as null (present, not absent) in the decoded row', async () => {
        // Grouping by the optional `g` alone (a distinct-like aggregate): the
        // merged null/absent group decodes with `g: null` PRESENT — the key is
        // null, never missing.
        await expectPipeline(
          src().aggregate(() => ({ accumulators: [countAll().as('c')], groups: ['g'] })),
          [{ data: { g: 'x', c: 2 } }, { data: { g: 'y', c: 1 } }, { data: { g: null, c: 2 } }],
          { ordered: false },
        );
      });
    });

    // The `distinct` stage, seeded to reproduce the probe rules in
    // docs/pipeline-query-aggregate-research.md's `distinct` section. `distinct`
    // is a grouped aggregate with zero accumulators, so it breaks read-identity
    // (rows carry no `id`) and every group rule carries over. Oracles are
    // hand-written FROM that doc; multi-row outputs are order-independent
    // (`{ ordered: false }`).
    describe('distinct', () => {
      // `cat` is always present (no null) — the clean duplicate-collapse key.
      // `g` holds a value, `null`, OR is absent — so the null-key and
      // absent-key docs demonstrate merging into one `null` row. `p.q` (an
      // optional leaf under a required map) is grouped via the EXPRESSION form
      // (dotted bare paths are rejected — TOP_LEVEL_PROPERTY_PATH_ONLY).
      const distinctCollection = rootCollection({
        name: 'Distinct',
        schema: {
          cat: string(),
          g: optional(nullable(string())),
          n: int64(),
          p: map({ q: optional(string()) }),
        },
      });
      type DistinctDoc = Doc<typeof distinctCollection>;
      const distinctItems: DistinctDoc[] = [
        { id: ['d1'], data: { cat: 'x', g: 'k', n: 1, p: { q: 'a' } } },
        { id: ['d2'], data: { cat: 'x', g: 'k', n: 2, p: { q: 'a' } } }, // dup of d1 on cat/g/q
        { id: ['d3'], data: { cat: 'y', g: 'm', n: 8, p: { q: 'b' } } },
        { id: ['d4'], data: { cat: 'y', g: null, n: 3, p: {} } }, // g null; q absent
        { id: ['d5'], data: { cat: 'z', n: 9, p: { q: 'a' } } }, // g absent
      ];

      let coll: typeof distinctCollection;
      beforeEach(async () => {
        coll = uniqueCollection(distinctCollection);
        await createRepository(coll).batchSet(distinctItems);
      });
      const src = () => collectionInput(coll);

      it('collapses duplicate group values to one row per distinct value', async () => {
        // cat: x (d1, d2), y (d3, d4), z (d5) → three distinct rows.
        await expectPipeline(
          src().distinct(() => ['cat']),
          [{ data: { cat: 'x' } }, { data: { cat: 'y' } }, { data: { cat: 'z' } }],
          { ordered: false },
        );
      });

      it('null and absent keys merge into ONE null row', async () => {
        // g: k (d1, d2), m (d3), null (d4), absent (d5). The null-value and the
        // absent-key doc collapse into a single row whose key reads back `null`.
        await expectPipeline(
          src().distinct(() => ['g']),
          [{ data: { g: 'k' } }, { data: { g: 'm' } }, { data: { g: null } }],
          { ordered: false },
        );
      });

      it('groups by an aliased expression (the computed key is projected)', async () => {
        // greaterThan(n, 5): d1/d2/d4 → false, d3/d5 → true.
        await expectPipeline(
          src().distinct((field) => [greaterThan(field('n'), constant(5)).as('big')]),
          [{ data: { big: false } }, { data: { big: true } }],
          { ordered: false },
        );
      });

      it('groups a nested field via the expression form; absent leaf merges into null', async () => {
        // p.q: a (d1, d2, d5), b (d3), absent (d4 → null). A dotted bare path is
        // rejected, so the nested field is grouped through `field('p.q').as('q')`.
        await expectPipeline(
          src().distinct((field) => [field('p.q').as('q')]),
          [{ data: { q: 'a' } }, { data: { q: 'b' } }, { data: { q: null } }],
          { ordered: false },
        );
      });

      it('groups by an UNALIASED top-level field expression, like the bare path', async () => {
        // Probed: an unaliased top-level `field('cat')` is accepted and its row
        // key is `cat` — the same rows the bare-path form produces above. (A
        // dotted bare `Field` would be TOP_LEVEL_PROPERTY_PATH_ONLY, which is
        // why it is rejected at the type level instead.)
        await expectPipeline(
          src().distinct((field) => [field('cat')]),
          [{ data: { cat: 'x' } }, { data: { cat: 'y' } }, { data: { cat: 'z' } }],
          { ordered: false },
        );
      });

      it('groups by multiple keys (distinct combinations)', async () => {
        // (cat, p.q): (x,a) d1/d2, (y,b) d3, (y,null) d4, (z,a) d5 → four combos.
        await expectPipeline(
          src().distinct((field) => ['cat', field('p.q').as('q')]),
          [
            { data: { cat: 'x', q: 'a' } },
            { data: { cat: 'y', q: 'b' } },
            { data: { cat: 'y', q: null } },
            { data: { cat: 'z', q: 'a' } },
          ],
          { ordered: false },
        );
      });
    });

    // The `unnest` stage, seeded to reproduce EVERY cell of the probe matrix in
    // docs/pipeline-query-unnest-research.md. Unlike select/distinct/aggregate,
    // `unnest` PRESERVES read-identity: rows still carry `id` — but ids are no
    // longer unique across rows (an n-element array yields n rows with the SAME
    // id). The source field survives alongside the alias (addFields-shaped
    // overlay). Multi-row outputs are order-independent (`{ ordered: false }`).
    describe('unnest', () => {
      // `t` is optional + nullable + array-of-nullable-string, so ONE field
      // exercises every non-happy cell: a real array (u1), an empty array (u2 —
      // emits nothing), a null source (u3), an absent source (u4), and a null
      // ELEMENT (u6). The element type stays nullable so the null element is
      // representable.
      const unnestCollection = rootCollection({
        name: 'Unnest',
        schema: { t: optional(nullable(array(nullable(string())))) },
      });
      type UnnestDoc = Doc<typeof unnestCollection>;
      const unnestItems: UnnestDoc[] = [
        { id: ['u1'], data: { t: ['a', 'b'] } }, //   2-element array
        { id: ['u2'], data: { t: [] } }, //           empty array → 0 rows
        { id: ['u3'], data: { t: null } }, //         null source → 1 no-op row
        { id: ['u4'], data: {} }, //                  absent source → 1 no-op row
        { id: ['u6'], data: { t: ['p', null] } }, //  a null ELEMENT is kept
      ];

      let coll: typeof unnestCollection;
      beforeEach(async () => {
        coll = uniqueCollection(unnestCollection);
        await createRepository(coll).batchSet(unnestItems);
      });
      const src = () => collectionInput(coll);

      it('emits one row per element, passing null/empty/absent through per the probed matrix', async () => {
        // u1 ['a','b'] → 2 rows; u2 [] → 0 rows; u3 null → one row alias null;
        // u4 absent → one row alias ABSENT (omitted); u6 ['p',null] → 2 rows,
        // the null element kept. The source field `t` survives alongside `e`.
        // Every row keeps its source `id` (identity preserved).
        await expectPipeline(
          src().unnest((field) => ({ selectable: field('t').as('e') })),
          [
            { id: ['u1'], data: { t: ['a', 'b'], e: 'a' } },
            { id: ['u1'], data: { t: ['a', 'b'], e: 'b' } },
            { id: ['u3'], data: { t: null, e: null } },
            { id: ['u4'], data: {} },
            { id: ['u6'], data: { t: ['p', null], e: 'p' } },
            { id: ['u6'], data: { t: ['p', null], e: null } },
          ],
          { ordered: false },
        );
      });

      it('the index field is always present, null on every no-op row (even the absent-alias one)', async () => {
        // The alias/index asymmetry: on the ABSENT-source row (u4) the alias `e`
        // is ABSENT (omitted) but the index `i` is null (present). null source
        // (u3) nulls both; a real array carries a real int64 offset.
        await expectPipeline(
          src().unnest((field) => ({ selectable: field('t').as('e'), indexField: 'i' })),
          [
            { id: ['u1'], data: { t: ['a', 'b'], e: 'a', i: 0 } },
            { id: ['u1'], data: { t: ['a', 'b'], e: 'b', i: 1 } },
            { id: ['u3'], data: { t: null, e: null, i: null } },
            { id: ['u4'], data: { i: null } },
            { id: ['u6'], data: { t: ['p', null], e: 'p', i: 0 } },
            { id: ['u6'], data: { t: ['p', null], e: null, i: 1 } },
          ],
          { ordered: false },
        );
      });

      it('an alias onto the source own name replaces the array with the element', async () => {
        // `field('t').as('t')`: rows whose `t` is the ELEMENT, no trace of the
        // array (probed). The no-op rows keep the pass-through value under `t`.
        await expectPipeline(
          src().unnest((field) => ({ selectable: field('t').as('t') })),
          [
            { id: ['u1'], data: { t: 'a' } },
            { id: ['u1'], data: { t: 'b' } },
            { id: ['u3'], data: { t: null } },
            { id: ['u4'], data: {} },
            { id: ['u6'], data: { t: 'p' } },
            { id: ['u6'], data: { t: null } },
          ],
          { ordered: false },
        );
      });

      it('rows from the SAME document carry the SAME id (identity preserved, not unique)', async () => {
        // The decided semantics: unnest does not break identity, but a 2-element
        // array yields two rows that BOTH carry the source document's id.
        const results = await executor.execute(
          src().unnest((field) => ({ selectable: field('t').as('e') })),
        );
        const u1Rows = results.filter((r) => r.id[0] === 'u1');
        expect(u1Rows).toHaveLength(2);
        // Both rows are the SAME document ref, differing only in the element.
        expect(u1Rows.map((r) => r.id)).toStrictEqual([['u1'], ['u1']]);
        assert.sameDeepMembers(
          u1Rows.map((r) => r.data.e),
          ['a', 'b'],
        );
      });
    });

    // `unnest` of a NESTED array via a dotted SOURCE path — the source path may
    // be dotted (only the OUTPUT name is top-level-restricted, probed). Its own
    // collection keeps the surviving-fields noise out of the matrix above.
    describe('unnest (nested source path)', () => {
      const nestedCollection = rootCollection({
        name: 'UnnestNested',
        schema: { m: map({ k: array(string()) }) },
      });
      let coll: typeof nestedCollection;
      beforeEach(async () => {
        coll = uniqueCollection(nestedCollection);
        await createRepository(coll).batchSet([{ id: ['mk1'], data: { m: { k: ['x', 'y'] } } }]);
      });

      it('unnests a non-empty nested array addressed by a dotted source path', async () => {
        await expectPipeline(
          collectionInput(coll).unnest((field) => ({ selectable: field('m.k').as('e') })),
          [
            { id: ['mk1'], data: { m: { k: ['x', 'y'] }, e: 'x' } },
            { id: ['mk1'], data: { m: { k: ['x', 'y'] }, e: 'y' } },
          ],
          { ordered: false },
        );
      });
    });
  });
};
