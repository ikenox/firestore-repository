import { describe, it } from 'vitest';

import { authorsCollection } from '../__test__/specification.js';
import { constant, equal } from './expression.js';
import { pipelineQuery } from './index.js';

describe('pipeline', () => {
  const base = pipelineQuery(authorsCollection);

  it('where', () => {
    base.where((field) => equal(field('profile'), constant({ gender: 'female', age: 20 })));
  });

  it('select', () => {
    // Only data field paths are valid selections for now (no `.as(...)` yet).
    base.select(() => ['profile.gender', 'name']);
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

    // `__name__` stays usable in `where` (goes through `FieldProvider`, not `Selection`)
    base.where((field) => equal(field('__name__'), field('name')));
  });
});
