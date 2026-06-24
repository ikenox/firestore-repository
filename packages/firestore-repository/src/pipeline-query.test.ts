import { describe, expectTypeOf, it } from 'vitest';

import { authorsCollection } from './__test__/specification.js';
import { equal, PipelineQuery, pipelineQuery } from './pipeline-query.js';
import type {
  ArrayType,
  DoubleType,
  LiteralType,
  MapType,
  Optional,
  StringType,
} from './schema.js';

describe('pipeline-query', () => {
  const base = pipelineQuery(authorsCollection);

  it('where', () => {
    base.where((field) => equal(field('profile'), { gender: 'female', age: 20 }));
  });
  it('wip', () => {
    expectTypeOf(base).toEqualTypeOf<
      PipelineQuery<{
        name: StringType;
        profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
        rank: DoubleType;
        tag: ArrayType<StringType, [], []>;
      }>
    >();
    expectTypeOf(base.select('name')).toEqualTypeOf<PipelineQuery<{ name: StringType }>>();
    expectTypeOf(base.select('name', 'tag')).toEqualTypeOf<
      PipelineQuery<{ name: StringType; tag: ArrayType<StringType, [], []> }>
    >();
    expectTypeOf(base.select('profile')).toEqualTypeOf<
      PipelineQuery<{
        profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
      }>
    >();
    expectTypeOf(base.select('profile.age')).toEqualTypeOf<
      PipelineQuery<{ profile: MapType<{ age: DoubleType }> }>
    >();

    // FIXME
    expectTypeOf(base.select('__name__')).toEqualTypeOf<PipelineQuery<{}>>();

    expectTypeOf(base.removeFields('name')).toEqualTypeOf<
      PipelineQuery<{
        profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
        rank: DoubleType;
        tag: ArrayType<StringType, [], []>;
      }>
    >();
    expectTypeOf(base.removeFields('name', 'profile.age')).toEqualTypeOf<
      PipelineQuery<{
        profile: MapType<{ gender: LiteralType<['male', 'female']> & Optional }>;
        rank: DoubleType;
        tag: ArrayType<StringType, [], []>;
      }>
    >();
  });
});
