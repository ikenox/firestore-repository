import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  type AuthorsCollection,
  authorsCollection,
  postsCollection,
} from '../__test__/specification.js';
import type { DocRef } from '../repository.js';
import {
  array,
  type ArrayType,
  type DoubleType,
  type Int64Type,
  type LiteralType,
  map,
  type MapType,
  nullable,
  type Optional,
  rootCollection,
  string,
  type StringType,
} from '../schema.js';
import { countAll, documentId, equal, field, mapValue, sum } from './expression.js';
import { collection, collectionGroup, type Pipeline, type PipelineResult } from './index.js';
import { asc } from './ordering.js';
import { documentMatches } from './search.js';

describe('pipeline', () => {
  const base = collection(authorsCollection);

  // Shared by the method-contract tests below. `RowOf` is the result-row type of
  // a pipeline (`id` present iff `Id` is a `DocRef` — see `PipelineResult`);
  // `SchemaOf` is its data-field schema. Every method-level test asserts three
  // things through the METHOD: the output `Schema` it threads, the `Id`
  // (identity) it carries, and the stage node it builds.
  type RowOf<P> = P extends Pipeline<infer S, infer I> ? PipelineResult<S, I> : never;
  type SchemaOf<P> = P extends Pipeline<infer S, infer _I> ? S : never;

  it('collection / collectionGroup start identity-preserving with the collection schema and an input node', () => {
    // The two document-backed inputs thread the collection's field schema as the
    // pipeline's `Schema` and a source document ref (`DocRef`) as its `Id`, so
    // result rows carry `id`. They differ only in the input node an executor
    // rebuilds the source from (a single instance vs. a collection group).
    expectTypeOf<SchemaOf<typeof base>>().toEqualTypeOf<AuthorsCollection['schema']>();
    const _preserving: Pipeline<AuthorsCollection['schema'], DocRef<AuthorsCollection>> = base;
    void _preserving;
    // @ts-expect-error -- a collection input is identity-preserving, not dropped
    const _notDropped: Pipeline<AuthorsCollection['schema'], undefined> = base;
    void _notDropped;
    expect(base.stages().input).toEqual({
      kind: 'collection',
      collection: authorsCollection,
      parent: [],
    });

    const group = collectionGroup(authorsCollection);
    expectTypeOf<SchemaOf<typeof group>>().toEqualTypeOf<AuthorsCollection['schema']>();
    const _groupPreserving: Pipeline<
      AuthorsCollection['schema'],
      DocRef<AuthorsCollection>
    > = group;
    void _groupPreserving;
    expect(group.stages().input).toEqual({
      kind: 'collectionGroup',
      collection: authorsCollection,
    });
  });

  it('where preserves the schema and identity, and carries a where-condition node', () => {
    const filtered = base.where((field) => equal(field('name'), field('name')));
    // `where` only drops rows — the schema is UNCHANGED and identity threads
    // through (rows still carry `id`).
    expectTypeOf<SchemaOf<typeof filtered>>().toEqualTypeOf<AuthorsCollection['schema']>();
    expectTypeOf<RowOf<typeof filtered>>().toHaveProperty('id');
    const _preserving: Pipeline<AuthorsCollection['schema'], DocRef<AuthorsCollection>> = filtered;
    void _preserving;
    // The stage node an executor walks: kind + the resolved condition expression.
    expect(filtered.stages().transforms).toEqual([
      {
        kind: 'where',
        condition: equal(
          field(base.node.schema.name, 'name'),
          field(base.node.schema.name, 'name'),
        ),
      },
    ]);
  });

  it('sort preserves the schema and identity, and carries a sort-orderings node', () => {
    const sorted = base.sort((field) => [asc(field('rank'))]);
    // Reordering rows changes neither the schema nor identity.
    expectTypeOf<SchemaOf<typeof sorted>>().toEqualTypeOf<AuthorsCollection['schema']>();
    expectTypeOf<RowOf<typeof sorted>>().toHaveProperty('id');
    const _preserving: Pipeline<AuthorsCollection['schema'], DocRef<AuthorsCollection>> = sorted;
    void _preserving;
    // The node carries the resolved `Ordering[]` (expression + direction).
    expect(sorted.stages().transforms).toEqual([
      { kind: 'sort', orderings: [asc(field(base.node.schema.rank, 'rank'))] },
    ]);
  });

  it('limit / offset preserve the schema and identity, and carry a count node', () => {
    const limited = base.limit(5);
    // Truncating / skipping rows changes neither the schema nor identity.
    expectTypeOf<SchemaOf<typeof limited>>().toEqualTypeOf<AuthorsCollection['schema']>();
    expectTypeOf<RowOf<typeof limited>>().toHaveProperty('id');
    const _limitPreserving: Pipeline<
      AuthorsCollection['schema'],
      DocRef<AuthorsCollection>
    > = limited;
    void _limitPreserving;
    expect(limited.stages().transforms).toEqual([{ kind: 'limit', limit: 5 }]);

    const skipped = base.offset(3);
    expectTypeOf<SchemaOf<typeof skipped>>().toEqualTypeOf<AuthorsCollection['schema']>();
    expectTypeOf<RowOf<typeof skipped>>().toHaveProperty('id');
    const _offsetPreserving: Pipeline<
      AuthorsCollection['schema'],
      DocRef<AuthorsCollection>
    > = skipped;
    void _offsetPreserving;
    expect(skipped.stages().transforms).toEqual([{ kind: 'offset', offset: 3 }]);
  });

  it('select projects to exactly the chosen fields and carries a select node', () => {
    const projected = base.select(() => ['name', 'rank']);
    // The output schema is EXACTLY the projected fields — every unselected field
    // is revoked (the identity drop is pinned separately, in the ratchet test).
    expectTypeOf<SchemaOf<typeof projected>>().toEqualTypeOf<{
      name: StringType;
      rank: DoubleType;
    }>();
    // The node carries the conflict-resolved selection list, 1:1 with the schema.
    expect(projected.stages().transforms).toEqual([
      { kind: 'select', selections: ['name', 'rank'] },
    ]);
  });

  it('addFields overlays the aliased field on the context and carries an addFields node', () => {
    const augmented = base.addFields((field) => [field('rank').as('score')]);
    // The output schema is the WHOLE input context plus the added alias (a
    // non-colliding alias, so every original field survives alongside `score`).
    expectTypeOf<SchemaOf<typeof augmented>>().toEqualTypeOf<{
      name: StringType;
      profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
      rank: DoubleType;
      tag: ArrayType<StringType>;
      score: DoubleType;
    }>();
    // Identity threads through (addFields reshapes without breaking identity).
    expectTypeOf<RowOf<typeof augmented>>().toHaveProperty('id');
    expect(augmented.stages().transforms).toEqual([
      {
        kind: 'addFields',
        selections: [{ expression: field(base.node.schema.rank, 'rank'), alias: 'score' }],
      },
    ]);
  });

  it('removeFields drops the named field and carries a removeFields node', () => {
    const trimmed = base.removeFields('tag');
    // The output schema is the context with exactly `tag` gone.
    expectTypeOf<SchemaOf<typeof trimmed>>().toEqualTypeOf<{
      name: StringType;
      profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
      rank: DoubleType;
    }>();
    // Identity threads through (removeFields reshapes without breaking identity).
    expectTypeOf<RowOf<typeof trimmed>>().toHaveProperty('id');
    expect(trimmed.stages().transforms).toEqual([{ kind: 'removeFields', fields: ['tag'] }]);
  });

  it('aggregate overlays accumulator results on the group keys and carries an aggregate node', () => {
    const grouped = base.aggregate((field) => ({
      accumulators: [sum(field('rank')).as('total')],
      groups: ['name'],
    }));
    // The output schema is the group key overlaid with the accumulator result.
    // `sum` over a group is nullable (an empty / all-null group sums to null —
    // probed), so `total` is `nullable(double())`; the `name` group key is not
    // optional, so it stays a plain string (only an optional key would merge
    // absent into null). Identity-breaking is pinned in the ratchet test above.
    expectTypeOf<SchemaOf<typeof grouped>>().toEqualTypeOf<{
      total: ReturnType<typeof nullable<DoubleType>>;
      name: StringType;
    }>();
    // The node carries the accumulators and the conflict-resolved group keys.
    expect(grouped.stages().transforms).toEqual([
      {
        kind: 'aggregate',
        accumulators: [sum(field(base.node.schema.rank, 'rank')).as('total')],
        groups: ['name'],
      },
    ]);
  });

  it('Id is structurally anchored: pipelines with different identities do not interchange', () => {
    // `Id` appears in a (phantom) property position, not only in recursive
    // method returns — otherwise TypeScript's coinductive comparison would make
    // every `Pipeline<Schema, *>` mutually assignable and an identity-dropped
    // pipeline could pose as identity-preserving (claiming an `id` that does
    // not exist at runtime).
    const selected = base.select(() => ['name']);

    // @ts-expect-error -- identity-dropped (`Id = undefined`) cannot pose as identity-preserving
    const _lie: Pipeline<{ name: StringType }, DocRef<AuthorsCollection>> = selected;
    // @ts-expect-error -- nor can identity-preserving pose as identity-dropped
    const _widen: Pipeline<AuthorsCollection['schema'], undefined> = base;
  });

  it('root collections take an optional empty parent; subcollections require one', () => {
    collection(authorsCollection, []); // the empty tuple is a root's valid ParentDocRef: ok
    // @ts-expect-error -- a root collection's parent doc ref is empty
    collection(authorsCollection, ['extra']);

    // @ts-expect-error -- a subcollection requires its parent doc ref
    collection(postsCollection);
    collection(postsCollection, ['author1']); // parent doc ref: ok
    // @ts-expect-error -- parent doc ref length must match the parent path
    collection(postsCollection, ['author1', 'extra']);
  });

  it('reshaped schemas reject stale field references downstream', () => {
    // Schema threading is bidirectional: reshaping stages not only expose new
    // fields downstream, they revoke the removed ones — at the type level AND
    // at runtime (the field provider resolves against the reshaped schema).

    expect(() =>
      // @ts-expect-error -- `rank` is not part of the projected schema
      base.select(() => ['name']).sort((field) => [asc(field('rank'))]),
    ).toThrow('schema has no field "rank"');

    expect(() =>
      // @ts-expect-error -- `tag` was removed by removeFields
      base.removeFields('tag').where((field) => equal(field('tag'), field('tag'))),
    ).toThrow('schema has no field "tag"');
  });

  it('identity ratchet: preserving stages keep `id`, select drops it for good', () => {
    // A chain of identity-preserving stages keeps `id` on the result rows.
    const preserved = base.removeFields('tag').addFields((field) => [field('rank').as('score')]);
    expectTypeOf<RowOf<typeof preserved>>().toHaveProperty('id');

    // `select` drops it...
    const projected = preserved.select(() => ['name']);
    expectTypeOf<RowOf<typeof projected>>().not.toHaveProperty('id');

    // ...and a downstream preserving stage never brings it back.
    const after = projected.sort((field) => [asc(field('name'))]);
    expectTypeOf<RowOf<typeof after>>().not.toHaveProperty('id');
  });

  it('__name__ is not projectable (keeps `select`/`removeFields` honest)', () => {
    // `select` / `removeFields` operate on data field paths only (`Selection` /
    // `MapFieldPath`), so the reserved `__name__` key cannot be projected or
    // removed. Projecting `__name__` un-aliased would preserve read-identity at
    // runtime, which the always-`undefined` `Id` on `select` would then lie
    // about — so it is a compile error. See `Selection`'s doc comment.

    // @ts-expect-error -- `__name__` is not a data field path
    base.select(() => ['__name__']);
    base.select(() => ['name']); // real data field: ok

    // @ts-expect-error -- `__name__` is not a removable data field
    base.removeFields('__name__');
    base.removeFields('name'); // real data field: ok

    // `__name__` stays usable in `where` (goes through `FieldProvider`, not
    // `Selection`). Its value is a REFERENCE (probed: type(__name__) is
    // "reference"), so it does not compare against strings directly —
    // documentId() bridges it into the string domain.
    base.where((field) => equal(documentId(field('__name__')), field('name')));
    // @ts-expect-error -- a reference does not compare against a string field
    base.where((field) => equal(field('__name__'), field('name')));
  });

  it('aggregate is identity-breaking (Id = undefined): a grouped row is not a source document', () => {
    const grouped = base.aggregate((field) => ({
      accumulators: [sum(field('rank')).as('total')],
      groups: ['name'],
    }));
    // No `id` on the result rows — the identity ratchet dropped it.
    expectTypeOf<RowOf<typeof grouped>>().not.toHaveProperty('id');

    // @ts-expect-error -- an aggregate pipeline cannot pose as identity-preserving
    const _lie: Pipeline<AuthorsCollection['schema'], DocRef<AuthorsCollection>> = grouped;
  });

  it('distinct is identity-breaking (Id = undefined) and carries a distinct stage node', () => {
    const distinct = base.distinct(() => ['name']);
    // No `id` on the result rows — a distinct row is not a source document.
    expectTypeOf<RowOf<typeof distinct>>().not.toHaveProperty('id');
    // The schema is EXACTLY the group key (distinct is an aggregate with zero
    // accumulators — nothing is overlaid).
    expectTypeOf<SchemaOf<typeof distinct>>().toEqualTypeOf<{ name: StringType }>();

    // The stage node an executor walks: kind + the conflict-resolved groups.
    expect(distinct.stages().transforms).toEqual([{ kind: 'distinct', groups: ['name'] }]);

    // @ts-expect-error -- a distinct pipeline cannot pose as identity-preserving
    const _lie: Pipeline<{ name: StringType }, DocRef<AuthorsCollection>> = distinct;
    void _lie;
  });

  it('distinct requires at least one group and rejects dotted group aliases', () => {
    const _rejections = () => {
      // @ts-expect-error -- at least one group is required (an empty distinct is meaningless)
      base.distinct(() => []);
      // @ts-expect-error -- a dotted group alias is rejected (TOP_LEVEL_PROPERTY_PATH_ONLY)
      base.distinct((field) => [field('profile.age').as('deep.alias')]);
    };
    void _rejections;
  });

  it('an unaliased Field is a selection: accepted by select, top-level-only in groups', () => {
    // A `Field<T, Path>` is inherently aliased — its `path` IS its alias (the
    // SDK's `Selectable` model) — so no `.as(...)` is needed to select it.
    // `select` allows any data path (dotted output nests); `aggregate` /
    // `distinct` groups are TOP-LEVEL outputs only, so a dotted bare `Field`
    // collapses through the same guard a dotted alias does
    // (TOP_LEVEL_PROPERTY_PATH_ONLY — probed).
    const selected = base.select((field) => [field('profile.age')]);
    // Identical to the string form, schema and stage node alike.
    expectTypeOf(selected).toEqualTypeOf(base.select(() => ['profile.age']));

    base.distinct((field) => [field('name')]); // top-level bare Field: ok
    base.aggregate((field) => ({ accumulators: [countAll().as('n')], groups: [field('name')] })); // top-level bare Field: ok

    const _rejections = () => {
      // @ts-expect-error -- a dotted bare Field is not a top-level group key
      base.distinct((field) => [field('profile.age')]);
      base.aggregate((field) => ({
        accumulators: [countAll().as('n')],
        // @ts-expect-error -- a dotted bare Field is not a top-level group key
        groups: [field('profile.age')],
      }));
      // `addFields` deliberately keeps excluding BOTH bare forms — re-adding an
      // existing field under its own name is meaningless. See BuildAddFieldsSchema.
      // @ts-expect-error -- addFields takes aliased expressions only
      base.addFields((field) => [field('rank')]);
    };
    void _rejections;
  });

  it('aggregate/distinct output names must be pairwise unique: every collision is rejected', () => {
    // The backend rejects ANY two output fields sharing a name in the aggregate
    // family (INVALID_ARGUMENT — probed), so the combined output-name SET (every
    // group output name ∪ every accumulator alias) must be pairwise distinct.
    // There is no winner to pick — each collision is a COMPILE error
    // (`UniqueAggregateOutputs`), unlike `select`/`addFields`/`unnest` whose
    // overlaps legitimately resolve.

    // Positive controls: distinct output names compile fine.
    base.aggregate((field) => ({
      accumulators: [countAll().as('n'), sum(field('rank')).as('total')],
      groups: ['name', 'rank'], // two group keys with different names: ok
    }));
    base.distinct(() => ['name', 'rank']); // two groups with different names: ok

    const _rejections = () => {
      // aggregate — an accumulator alias equal to a group name.
      base.aggregate(() => ({
        // @ts-expect-error -- accumulator alias `name` collides with the group name `name`
        accumulators: [countAll().as('name')],
        groups: ['name'],
      }));
      // aggregate — two accumulators with the same alias.
      base.aggregate((field) => ({
        // @ts-expect-error -- two accumulators share the alias `c`
        accumulators: [countAll().as('c'), sum(field('rank')).as('c')],
      }));
      // aggregate — two group keys with the same output name (bare string vs
      // aliased expression naming the same output).
      base.aggregate((field) => ({
        accumulators: [countAll().as('c')],
        // @ts-expect-error -- two group keys share the output name `name`
        groups: ['name', field('rank').as('name')],
      }));
      // distinct — two group keys with the same output name.
      // @ts-expect-error -- two group keys share the output name `name`
      base.distinct((field) => ['name', field('rank').as('name')]);
    };
    void _rejections;
  });

  // A nested array — the shape that distinguishes `unnest`'s output-name rule
  // from `select`'s: the SOURCE path may be dotted, the OUTPUT name may not.
  const nestedArrayCollection = rootCollection({
    name: 'NestedArray',
    schema: { m: map({ k: array(string()) }) },
  });

  it('unnest takes a bare Field: its path IS its output name, so it replaces the source', () => {
    // No `.as(...)` needed — a `Field` is inherently aliased (the SDK's
    // `Selectable` model), so `field('tag')` names its own output. Because that
    // output name IS the source's name, the array is replaced by the element.
    const bare = base.unnest((field) => ({ selectable: field('tag') }));
    expectTypeOf<SchemaOf<typeof bare>>().toEqualTypeOf<{
      name: StringType;
      profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
      rank: DoubleType;
      tag: StringType;
    }>();
    // Identical to spelling the alias out, exactly as in `select`.
    const aliased = base.unnest((field) => ({ selectable: field('tag').as('tag') }));
    expectTypeOf<SchemaOf<typeof bare>>().toEqualTypeOf<SchemaOf<typeof aliased>>();
    expect(bare.stages().transforms).toEqual([
      { kind: 'unnest', selectable: field(base.node.schema.tag, 'tag') },
    ]);
  });

  it('unnest PRESERVES identity: rows keep `id`, and the pipeline stays identity-preserving', () => {
    // `tag` is an array field; unnesting it keeps read-identity — an emitted row
    // still came from its source document (though ids are no longer unique
    // across rows). Contrast the identity-BREAKING stages above.
    const unnested = base.unnest((field) => ({ selectable: field('tag').as('t') }));
    expectTypeOf<RowOf<typeof unnested>>().toHaveProperty('id');

    // Assignable where an identity-preserving pipeline is expected (the schema is
    // the input context with the alias `t` overlaid). Threads the SAME `Id`.
    const _preserving: Pipeline<
      AuthorsCollection['schema'] & { t: StringType },
      DocRef<AuthorsCollection>
    > = unnested;
    void _preserving;

    // A downstream preserving stage keeps it, and the stage node carries the
    // selectable (plus the index field when requested).
    const withIndex = base.unnest((field) => ({
      selectable: field('tag').as('t'),
      indexField: 'i',
    }));
    expectTypeOf<RowOf<typeof withIndex>>().toHaveProperty('id');
    expect(withIndex.stages().transforms).toEqual([
      {
        kind: 'unnest',
        selectable: { expression: field(base.node.schema.tag, 'tag'), alias: 't' },
        indexField: 'i',
      },
    ]);
  });

  it('unnest overlays the index field on the output schema (the requested index name → int64)', () => {
    // `tag` is a REQUIRED array, so the index is a plain `int64()` (a row from a
    // real array always has a real offset; only a nullable/optional source makes
    // it nullable — covered exhaustively at the `buildUnnestSchema` level). Here
    // we pin that the `Index` type param threads through the METHOD onto the
    // output schema, at its own top-level name alongside the alias.
    const withIndex = base.unnest((field) => ({
      selectable: field('tag').as('t'),
      indexField: 'i',
    }));
    expectTypeOf<SchemaOf<typeof withIndex>>().toEqualTypeOf<{
      name: StringType;
      profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
      rank: DoubleType;
      tag: ArrayType<StringType>;
      t: StringType;
      i: Int64Type;
    }>();

    // An index field colliding with an EXISTING field overwrites it, added-field-
    // wins (probed): `rank` (a double) becomes the int64 offset.
    const overIndex = base.unnest((field) => ({
      selectable: field('tag').as('t'),
      indexField: 'rank',
    }));
    expectTypeOf<SchemaOf<typeof overIndex>>().toEqualTypeOf<{
      name: StringType;
      profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
      rank: Int64Type;
      tag: ArrayType<StringType>;
      t: StringType;
    }>();
  });

  it('unnest rejects dotted output names and a non-array selectable at the type level', () => {
    const _rejections = () => {
      // A dotted ALIAS is not a top-level output (TOP_LEVEL_PROPERTY_PATH_ONLY).
      // @ts-expect-error -- a dotted unnest alias is rejected
      base.unnest((field) => ({ selectable: field('tag').as('out.t') }));
      // A dotted INDEX field is likewise top-level only.
      // @ts-expect-error -- a dotted unnest indexField is rejected
      base.unnest((field) => ({ selectable: field('tag').as('t'), indexField: 'ix.j' }));
      // The selectable must be ARRAY-valued — a scalar field is not unnestable.
      // @ts-expect-error -- a non-array selectable is rejected
      base.unnest((field) => ({ selectable: field('name').as('n') }));
      // A BARE `Field` at a dotted path is rejected too: its path IS its output
      // name, so it would be a dotted output. This is where `unnest` parts ways
      // with `select`, which accepts the same selectable and nests it instead —
      // reach a nested array with an explicit top-level alias.
      // @ts-expect-error -- a dotted bare Field is not a top-level output
      collection(nestedArrayCollection).unnest((field) => ({ selectable: field('m.k') }));
      collection(nestedArrayCollection).unnest((field) => ({ selectable: field('m.k').as('e') }));
    };
    void _rejections;
  });

  it('replaceWith BREAKS identity (Id = undefined): the document becomes the map', () => {
    // The document BECOMES the map source, so the result IS its field record.
    // Sourcing from the map field `profile` makes the document its two fields
    // (the inner `gender` optional survives). Identity is dropped — the map is
    // the whole document, no re-addressable `__name__` (probed).
    const replaced = base.replaceWith((field) => field('profile'));
    expectTypeOf<SchemaOf<typeof replaced>>().toEqualTypeOf<{
      age: DoubleType;
      gender: LiteralType<['male', 'female']> & Optional;
    }>();
    // No `id` on the result rows — the identity ratchet dropped it.
    expectTypeOf<RowOf<typeof replaced>>().not.toHaveProperty('id');

    // The stage node an executor walks: the map expression + the resolved wire
    // mode `full_replace`.
    expect(replaced.stages().transforms).toEqual([
      {
        kind: 'replaceWith',
        map: field(base.node.schema.profile, 'profile'),
        mode: 'full_replace',
      },
    ]);

    // @ts-expect-error -- a replaceWith pipeline cannot pose as identity-preserving
    const _lie: Pipeline<{ age: DoubleType }, DocRef<AuthorsCollection>> = replaced;
    void _lie;
  });

  it('mergeOverwrite PRESERVES identity and the map wins a shallow collision', () => {
    // The map is merged onto the existing document, so the row keeps its `id`
    // (identity threads through — a merge reshapes in place, probed). The map
    // WINS a top-level collision, so `rank` becomes the string the map supplies.
    const overwritten = base.mergeOverwrite((field) => mapValue({ rank: field('name') }));
    expectTypeOf<SchemaOf<typeof overwritten>>().toEqualTypeOf<{
      name: StringType;
      profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
      rank: StringType;
      tag: ArrayType<StringType>;
    }>();
    expectTypeOf<RowOf<typeof overwritten>>().toHaveProperty('id');
    // Threads the SAME `Id` — assignable where an identity-preserving pipeline is
    // expected.
    const _preserving: Pipeline<
      Omit<AuthorsCollection['schema'], 'rank'> & { rank: StringType },
      DocRef<AuthorsCollection>
    > = overwritten;
    void _preserving;

    // The stage node carries the map expression and the resolved wire mode.
    expect(overwritten.stages().transforms).toEqual([
      {
        kind: 'replaceWith',
        map: mapValue({ rank: field(base.node.schema.name, 'name') }),
        mode: 'merge_overwrite_existing',
      },
    ]);
  });

  it('mergeKeep PRESERVES identity and the existing wins a shallow collision', () => {
    // The existing `rank` (a double) wins the collision, so the schema is the
    // source schema unchanged; the row keeps its `id`.
    const kept = base.mergeKeep((field) => mapValue({ rank: field('name') }));
    expectTypeOf<SchemaOf<typeof kept>>().toEqualTypeOf<AuthorsCollection['schema']>();
    expectTypeOf<RowOf<typeof kept>>().toHaveProperty('id');
    const _preserving: Pipeline<AuthorsCollection['schema'], DocRef<AuthorsCollection>> = kept;
    void _preserving;

    expect(kept.stages().transforms).toEqual([
      {
        kind: 'replaceWith',
        map: mapValue({ rank: field(base.node.schema.name, 'name') }),
        mode: 'merge_keep_existing',
      },
    ]);
  });

  it('replaceWith / mergeOverwrite / mergeKeep reject a non-map source at the type level', () => {
    const _rejections = () => {
      // The source must be MAP-valued — a scalar field is not a document shape.
      // @ts-expect-error -- a string field is not a map-valued replaceWith source
      base.replaceWith((field) => field('name'));
      // @ts-expect-error -- a string field is not a map-valued mergeOverwrite source
      base.mergeOverwrite((field) => field('name'));
      // @ts-expect-error -- a string field is not a map-valued mergeKeep source
      base.mergeKeep((field) => field('name'));
    };
    void _rejections;
  });

  it('search preserves the schema and identity when no score alias is asked for', () => {
    const searched = base.search({ query: documentMatches('waffles') });
    // A search only filters — the schema is UNCHANGED and identity threads
    // through (the rows are the source documents, refs included — probed).
    expectTypeOf<SchemaOf<typeof searched>>().toEqualTypeOf<AuthorsCollection['schema']>();
    expectTypeOf<RowOf<typeof searched>>().toHaveProperty('id');
    const _preserving: Pipeline<AuthorsCollection['schema'], DocRef<AuthorsCollection>> = searched;
    void _preserving;
    // Only the options that were asked for reach the node.
    expect(searched.stages().transforms).toEqual([
      { kind: 'search', query: { kind: 'documentMatches', rquery: 'waffles' } },
    ]);
  });

  it('search takes its options directly or through a field callback, identically', () => {
    // The callback exists only to hand over the typed field accessor, so a query
    // that needs no field skips it — the rule that already leaves `limit` /
    // `offset` / `removeFields` callback-free. Both forms infer the same alias
    // and build the same node.
    const direct = base.search({ query: documentMatches('waffles'), scoreAs: 'relevance' });
    const viaCallback = base.search(() => ({
      query: documentMatches('waffles'),
      scoreAs: 'relevance',
    }));
    expectTypeOf<SchemaOf<typeof direct>>().toEqualTypeOf<SchemaOf<typeof viaCallback>>();
    expect(direct.stages().transforms).toEqual(viaCallback.stages().transforms);
  });

  it('search adds the score as a double under its alias, keeping identity', () => {
    const scored = base.search({
      query: documentMatches('waffles'),
      scoreAs: 'relevance',
      sort: { by: 'score', direction: 'descending' },
      languageCode: 'en',
      retrievalDepth: 100,
      limit: 10,
      offset: 5,
    });
    expectTypeOf<SchemaOf<typeof scored>>().toEqualTypeOf<{
      name: StringType;
      profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
      rank: DoubleType;
      tag: ArrayType<StringType>;
      relevance: DoubleType;
    }>();
    expectTypeOf<RowOf<typeof scored>>().toHaveProperty('id');
    expect(scored.stages().transforms).toEqual([
      {
        kind: 'search',
        query: { kind: 'documentMatches', rquery: 'waffles' },
        scoreAs: 'relevance',
        sort: { by: 'score', direction: 'descending' },
        languageCode: 'en',
        retrievalDepth: 100,
        limit: 10,
        offset: 5,
      },
    ]);
  });

  it('a score alias colliding with an existing field replaces it, whole', () => {
    // The `addFields` overlay rule: added-field-wins, and a non-map value takes
    // a colliding map WHOLESALE — what the backend does (probed).
    const overMap = base.search({ query: documentMatches('x'), scoreAs: 'profile' });
    expectTypeOf<SchemaOf<typeof overMap>>().toEqualTypeOf<{
      name: StringType;
      profile: DoubleType;
      rank: DoubleType;
      tag: ArrayType<StringType>;
    }>();
  });

  it('search rejects the shapes the backend cannot run, at the type level', () => {
    const _rejections = () => {
      // The score alias names a TOP-LEVEL output: a dotted alias returns
      // INTERNAL from the backend rather than a clean rejection (probed), so it
      // is banned here — the `unnest` indexField precedent.
      // @ts-expect-error -- a dotted score alias is not a top-level output name
      base.search({ query: documentMatches('x'), scoreAs: 'a.b' });
      // `offset` is only expressible alongside `limit` (the backend rejects it
      // on its own).
      // @ts-expect-error -- offset without limit
      base.search({ query: documentMatches('x'), offset: 5 });
      // The query is a `SearchQuery`, NOT a boolean expression: the backend
      // accepts only `document_matches` here, so `and`/`or`/comparisons — which
      // a boolean-expression parameter would admit — are unrepresentable.
      // @ts-expect-error -- a comparison is not a SearchQuery
      base.search((field) => ({ query: equal(field('name'), 'x') }));
      // Only the score ordering exists, descending only.
      // @ts-expect-error -- score() ascending is rejected by the backend
      base.search({ query: documentMatches('x'), sort: { by: 'score', direction: 'ascending' } });
    };
    void _rejections;
  });

  it('a search query is not an expression (misplacement is a type error)', () => {
    // The `AggregateFunction` treatment: `documentMatches` only makes sense as a
    // search stage's query, and the backend rejects it everywhere else
    // ("The 'document_matches' function can only be used in the search(...)
    // stage" — probed), so misplacing one is a compile error here.
    const _misplacements = () => {
      // @ts-expect-error -- a SearchQuery is not a boolean-valued condition
      base.where(() => documentMatches('x'));
      // @ts-expect-error -- a SearchQuery is not a select selection
      base.select(() => [documentMatches('x')]);
    };
    void _misplacements;
  });

  it('accumulators and expressions do not interchange across stages (misplacement is a type error)', () => {
    // An accumulator is deliberately NOT an Expression: it only makes sense
    // inside `aggregate`, so misplacing one where a value expression / a
    // selection is expected is a compile error, not a runtime failure. These
    // are compile-time claims only — the closure is never invoked, since
    // `select`/`addFields` would eagerly fold the (ill-typed) selection.
    const _misplacements = () => {
      // @ts-expect-error -- an AggregateFunction is not a boolean-valued condition
      base.where(() => countAll());
      // @ts-expect-error -- an aggregate selectable is not a select selection
      base.select(() => [countAll().as('n')]);
      // @ts-expect-error -- an aggregate selectable is not an addFields selection
      base.addFields((field) => [sum(field('rank')).as('total')]);
    };
    void _misplacements;
  });
});
