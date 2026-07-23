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
  type Optional,
  rootCollection,
  string,
  type StringType,
} from '../schema.js';
import { countAll, documentId, equal, field, sum } from './expression.js';
import { collection, type Pipeline, type PipelineResult } from './index.js';
import { asc } from './ordering.js';

describe('pipeline', () => {
  const base = collection(authorsCollection);

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
    // The result-row type of a pipeline: `id` present iff `Id` is a `DocRef`.
    type RowOf<P> = P extends Pipeline<infer S, infer I> ? PipelineResult<S, I> : never;

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
    type RowOf<P> = P extends Pipeline<infer S, infer I> ? PipelineResult<S, I> : never;

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
    type RowOf<P> = P extends Pipeline<infer S, infer I> ? PipelineResult<S, I> : never;
    type SchemaOf<P> = P extends Pipeline<infer S, infer _I> ? S : never;

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

  // A nested array — the shape that distinguishes `unnest`'s output-name rule
  // from `select`'s: the SOURCE path may be dotted, the OUTPUT name may not.
  const nestedArrayCollection = rootCollection({
    name: 'NestedArray',
    schema: { m: map({ k: array(string()) }) },
  });

  it('unnest takes a bare Field: its path IS its output name, so it replaces the source', () => {
    type SchemaOf<P> = P extends Pipeline<infer S, infer _I> ? S : never;

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
    type RowOf<P> = P extends Pipeline<infer S, infer I> ? PipelineResult<S, I> : never;

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
    type SchemaOf<P> = P extends Pipeline<infer S, infer _I> ? S : never;

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
