import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  type AuthorsCollection,
  authorsCollection,
  postsCollection,
} from '../__test__/specification.js';
import type { DocRef } from '../repository.js';
import type { StringType } from '../schema.js';
import { documentId, equal } from './expression.js';
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
});
