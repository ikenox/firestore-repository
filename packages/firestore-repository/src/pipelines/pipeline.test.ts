import { describe, expectTypeOf, it } from 'vitest';

import { authorsCollection } from '../__test__/specification.js';
import type {
  ArrayType,
  DoubleType,
  LiteralType,
  MapType,
  Optional,
  StringType,
} from '../schema.js';
import { constant, equal } from './expression.js';
import { Pipeline } from './pipeline.js';
import { pipelineQuery } from './index.js';

describe('pipeline', () => {
  const base = pipelineQuery(authorsCollection);

  it('where', () => {
    base.where((field) => equal(field('profile'), constant({ gender: 'female', age: 20 })));
  });

  it('select', () => {
    base.select((field) => ['profile.gender', field('name'), field('name'), equal(1, 2)]);
  });

  it('wip', () => {
    expectTypeOf(base).toEqualTypeOf<
      Pipeline<{
        name: StringType;
        profile: MapType<{
          age: DoubleType;
          gender: LiteralType<['male', 'female']> & Optional;
        }>;
        rank: DoubleType;
        tag: ArrayType<StringType, [], []>;
      }>
    >();
    expectTypeOf(base.select('name')).toEqualTypeOf<Pipeline<{ name: StringType }>>();
    expectTypeOf(base.select('name', 'tag')).toEqualTypeOf<
      Pipeline<{ name: StringType; tag: ArrayType<StringType, [], []> }>
    >();
    expectTypeOf(base.select('profile')).toEqualTypeOf<
      Pipeline<{
        profile: MapType<{
          age: DoubleType;
          gender: LiteralType<['male', 'female']> & Optional;
        }>;
      }>
    >();
    expectTypeOf(base.select('profile.age')).toEqualTypeOf<
      Pipeline<{ profile: MapType<{ age: DoubleType }> }>
    >();

    // FIXME
    expectTypeOf(base.select('__name__')).toEqualTypeOf<Pipeline<{}>>();

    expectTypeOf(base.removeFields('name')).toEqualTypeOf<
      Pipeline<{
        profile: MapType<{
          age: DoubleType;
          gender: LiteralType<['male', 'female']> & Optional;
        }>;
        rank: DoubleType;
        tag: ArrayType<StringType, [], []>;
      }>
    >();
    expectTypeOf(base.removeFields('name', 'profile.age')).toEqualTypeOf<
      Pipeline<{
        profile: MapType<{
          gender: LiteralType<['male', 'female']> & Optional;
        }>;
        rank: DoubleType;
        tag: ArrayType<StringType, [], []>;
      }>
    >();
  });
});
