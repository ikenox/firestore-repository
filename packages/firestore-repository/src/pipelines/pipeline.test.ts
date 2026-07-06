import { describe, it } from 'vitest';

import { authorsCollection, postsCollection } from '../__test__/specification.js';
import { equal } from './expression.js';
import { collection } from './index.js';

describe('pipeline', () => {
  const base = collection(authorsCollection);

  it('root collections take no parent; subcollections require one', () => {
    // @ts-expect-error -- a root collection has no parent doc ref
    collection(authorsCollection, []);

    // @ts-expect-error -- a subcollection requires its parent doc ref
    collection(postsCollection);
    collection(postsCollection, ['author1']); // parent doc ref: ok
    // @ts-expect-error -- parent doc ref length must match the parent path
    collection(postsCollection, ['author1', 'extra']);
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
