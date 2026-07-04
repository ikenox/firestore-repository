import { describe, expectTypeOf, it } from 'vitest';

import { authorsCollection } from '../__test__/specification.js';
import type { DocRef } from '../repository.js';
import type {
  ArrayType,
  DoubleType,
  LiteralType,
  MapType,
  Optional,
  StringType,
} from '../schema.js';
import { constant, equal } from './expression.js';
import { pipelineQuery } from './index.js';
import { Pipeline } from './pipeline.js';

type AuthorsId = DocRef<typeof authorsCollection>;

describe('pipeline', () => {
  const base = pipelineQuery(authorsCollection);

  it('where', () => {
    base.where((field) => equal(field('profile'), constant({ gender: 'female', age: 20 })));
  });

  it('select', () => {
    base.select((field) => ['profile.gender', field('name'), field('name'), equal(1, 2)]);
  });

  it('wip', () => {
    // The base pipeline preserves read-identity: `Id` is the source collection's ref.
    expectTypeOf(base).toEqualTypeOf<
      Pipeline<
        {
          name: StringType;
          profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
          rank: DoubleType;
          tag: ArrayType<StringType, [], []>;
        },
        AuthorsId
      >
    >();
    // `select` is identity-breaking: `Id` ratchets to `undefined`.
    expectTypeOf(base.select('name')).toEqualTypeOf<Pipeline<{ name: StringType }, undefined>>();
    expectTypeOf(base.select('name', 'tag')).toEqualTypeOf<
      Pipeline<{ name: StringType; tag: ArrayType<StringType, [], []> }, undefined>
    >();
    expectTypeOf(base.select('profile')).toEqualTypeOf<
      Pipeline<
        {
          profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
        },
        undefined
      >
    >();
    expectTypeOf(base.select('profile.age')).toEqualTypeOf<
      Pipeline<{ profile: MapType<{ age: DoubleType }> }, undefined>
    >();

    // `__name__` is intentionally NOT selectable (Selection uses MapFieldPath,
    // not the doc-level DocFieldPath): projecting it un-aliased would preserve the
    // row key at runtime, which `select`'s `Id = undefined` would then lie
    // about. `select('__name__')` is therefore a type error.

    // `removeFields` is identity-preserving: `Id` is threaded through unchanged.
    expectTypeOf(base.removeFields('name')).toEqualTypeOf<
      Pipeline<
        {
          profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
          rank: DoubleType;
          tag: ArrayType<StringType, [], []>;
        },
        AuthorsId
      >
    >();
    expectTypeOf(base.removeFields('name', 'profile.age')).toEqualTypeOf<
      Pipeline<
        {
          profile: MapType<{ gender: LiteralType<['male', 'female']> & Optional }>;
          rank: DoubleType;
          tag: ArrayType<StringType, [], []>;
        },
        AuthorsId
      >
    >();
  });
});
