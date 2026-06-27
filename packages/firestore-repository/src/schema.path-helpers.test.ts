import { describe, expectTypeOf, it } from 'vitest';

import type {
  ArrayType,
  DoubleType,
  LiteralType,
  MapType,
  OmitPaths,
  Optional,
  PickPaths,
  StringType,
  TailPath,
} from './schema.js';

type Schema = {
  name: StringType;
  profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
  rank: DoubleType;
  tag: ArrayType<StringType, [], []>;
};

describe('TailPath', () => {
  it('returns never when no path under K exists in P', () => {
    expectTypeOf<TailPath<'profile', 'name'>>().toEqualTypeOf<never>();
    expectTypeOf<TailPath<'profile', never>>().toEqualTypeOf<never>();
    expectTypeOf<TailPath<'profile', 'rank'>>().toEqualTypeOf<never>();
  });

  it('returns the suffix when P starts with `${K}.`', () => {
    expectTypeOf<TailPath<'profile', 'profile.age'>>().toEqualTypeOf<'age'>();
    expectTypeOf<TailPath<'profile', 'profile.x.y'>>().toEqualTypeOf<'x.y'>();
  });

  it('returns the union of suffixes when P is a union', () => {
    expectTypeOf<
      TailPath<'profile', 'name' | 'profile.age' | 'profile.gender' | 'rank'>
    >().toEqualTypeOf<'age' | 'gender'>();
  });

  it('ignores an exact match of K (no trailing `.`)', () => {
    expectTypeOf<TailPath<'profile', 'profile'>>().toEqualTypeOf<never>();
  });
});

describe('PickPaths', () => {
  it('picks a single top-level field', () => {
    expectTypeOf<PickPaths<Schema, 'name'>>().toEqualTypeOf<{ name: StringType }>();
  });

  it('picks multiple top-level fields', () => {
    expectTypeOf<PickPaths<Schema, 'name' | 'rank'>>().toEqualTypeOf<{
      name: StringType;
      rank: DoubleType;
    }>();
  });

  it('picks a nested field and shrinks its MapType', () => {
    expectTypeOf<PickPaths<Schema, 'profile.age'>>().toEqualTypeOf<{
      profile: MapType<{ age: DoubleType }>;
    }>();
  });

  it('preserves the Optional marker on a nested MapType', () => {
    type S = { profile: MapType<{ age: DoubleType; gender: StringType }> & Optional };
    expectTypeOf<PickPaths<S, 'profile.age'>>().toEqualTypeOf<{
      profile: MapType<{ age: DoubleType }> & Optional;
    }>();
  });

  it('keeps an entire subtree when the top-level key is selected directly', () => {
    expectTypeOf<PickPaths<Schema, 'profile'>>().toEqualTypeOf<{
      profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
    }>();
  });

  it('returns an empty schema when no path matches', () => {
    // biome-ignore lint/complexity/noBannedTypes: empty type is the expected result
    expectTypeOf<PickPaths<Schema, 'nonexistent'>>().toEqualTypeOf<{}>();
  });

  it('combines top-level and nested paths', () => {
    expectTypeOf<PickPaths<Schema, 'name' | 'profile.age'>>().toEqualTypeOf<{
      name: StringType;
      profile: MapType<{ age: DoubleType }>;
    }>();
  });
});

describe('OmitPaths', () => {
  it('removes a single top-level field', () => {
    expectTypeOf<OmitPaths<Schema, 'name'>>().toEqualTypeOf<{
      profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
      rank: DoubleType;
      tag: ArrayType<StringType, [], []>;
    }>();
  });

  it('removes a nested field while preserving the rest of the MapType', () => {
    expectTypeOf<OmitPaths<Schema, 'profile.gender'>>().toEqualTypeOf<{
      name: StringType;
      profile: MapType<{ age: DoubleType }>;
      rank: DoubleType;
      tag: ArrayType<StringType, [], []>;
    }>();
  });

  it('preserves the Optional marker when removing a nested field', () => {
    type S = { profile: MapType<{ age: DoubleType; gender: StringType }> & Optional };
    expectTypeOf<OmitPaths<S, 'profile.gender'>>().toEqualTypeOf<{
      profile: MapType<{ age: DoubleType }> & Optional;
    }>();
  });

  it('drops the whole subtree when a top-level key matches exactly', () => {
    expectTypeOf<OmitPaths<Schema, 'profile'>>().toEqualTypeOf<{
      name: StringType;
      rank: DoubleType;
      tag: ArrayType<StringType, [], []>;
    }>();
  });

  it('returns the original schema when no path matches', () => {
    expectTypeOf<OmitPaths<Schema, 'nonexistent'>>().toEqualTypeOf<Schema>();
  });

  it('removes both top-level and nested fields at once', () => {
    expectTypeOf<OmitPaths<Schema, 'name' | 'profile.gender'>>().toEqualTypeOf<{
      profile: MapType<{ age: DoubleType }>;
      rank: DoubleType;
      tag: ArrayType<StringType, [], []>;
    }>();
  });

  it('drops a map once its last field is removed', () => {
    type S = { name: StringType; profile: MapType<{ age: DoubleType }> };
    expectTypeOf<OmitPaths<S, 'profile.age'>>().toEqualTypeOf<{ name: StringType }>();
  });

  it('drops a map when all of its fields are removed at once', () => {
    expectTypeOf<OmitPaths<Schema, 'profile.age' | 'profile.gender'>>().toEqualTypeOf<{
      name: StringType;
      rank: DoubleType;
      tag: ArrayType<StringType, [], []>;
    }>();
  });

  it('removes a deeply nested field while preserving its siblings', () => {
    type S = { a: MapType<{ b: MapType<{ c: DoubleType; d: StringType }> }> };
    expectTypeOf<OmitPaths<S, 'a.b.c'>>().toEqualTypeOf<{
      a: MapType<{ b: MapType<{ d: StringType }> }>;
    }>();
  });

  it('cascades the empty-map drop up through multiple levels', () => {
    type S = { name: StringType; a: MapType<{ b: MapType<{ c: DoubleType }> }> };
    // Removing the only leaf empties `a.b`, which empties `a`, dropping both.
    expectTypeOf<OmitPaths<S, 'a.b.c'>>().toEqualTypeOf<{ name: StringType }>();
  });
});
