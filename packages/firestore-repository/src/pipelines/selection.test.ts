import { describe, expectTypeOf, it } from 'vitest';

import type {
  ArrayType,
  DoubleType,
  LiteralType,
  MapType,
  Optional,
  StringType,
} from '../schema.js';
import type {
  BuildAddFieldsSchema,
  BuildSelectionSchema,
  ExpressionWithAlias,
} from './selection.js';

type Schema = {
  name: StringType;
  profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
  rank: DoubleType;
  tag: ArrayType<StringType, [], []>;
};

describe('BuildSelectionSchema', () => {
  describe('empty', () => {
    it('returns {} for an empty selection list', () => {
      expectTypeOf<BuildSelectionSchema<Schema, []>>().toEqualTypeOf<{}>();
    });
  });

  describe('string paths', () => {
    it('picks a top-level field', () => {
      expectTypeOf<BuildSelectionSchema<Schema, ['name']>>().toEqualTypeOf<{ name: StringType }>();
    });

    it('picks a top-level subtree as a MapType', () => {
      expectTypeOf<BuildSelectionSchema<Schema, ['profile']>>().toEqualTypeOf<{
        profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
      }>();
    });

    it('builds a nested MapType from a dotted path', () => {
      expectTypeOf<BuildSelectionSchema<Schema, ['profile.age']>>().toEqualTypeOf<{
        profile: MapType<{ age: DoubleType }>;
      }>();
    });

    it('preserves the Optional marker at the leaf of a dotted path', () => {
      expectTypeOf<BuildSelectionSchema<Schema, ['profile.gender']>>().toEqualTypeOf<{
        profile: MapType<{ gender: LiteralType<['male', 'female']> & Optional }>;
      }>();
    });

    it('merges disjoint top-level selections', () => {
      expectTypeOf<BuildSelectionSchema<Schema, ['name', 'tag']>>().toEqualTypeOf<{
        name: StringType;
        tag: ArrayType<StringType, [], []>;
      }>();
    });

    it('deep-merges siblings under a common parent', () => {
      expectTypeOf<
        BuildSelectionSchema<Schema, ['profile.age', 'profile.gender']>
      >().toEqualTypeOf<{
        profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
      }>();
    });

    it('last-wins: a child path after its parent replaces the parent subtree', () => {
      // `profile` selects the whole subtree, but the later, conflicting
      // `profile.age` wins and leaves only `age`.
      expectTypeOf<BuildSelectionSchema<Schema, ['profile', 'profile.age']>>().toEqualTypeOf<{
        profile: MapType<{ age: DoubleType }>;
      }>();
    });

    it('last-wins: a parent path after its child replaces with the full subtree', () => {
      // The later `profile` wins over the earlier `profile.age`.
      expectTypeOf<BuildSelectionSchema<Schema, ['profile.age', 'profile']>>().toEqualTypeOf<{
        profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
      }>();
    });

    it('merges three selections covering both top-level and nested', () => {
      expectTypeOf<BuildSelectionSchema<Schema, ['name', 'profile.age', 'rank']>>().toEqualTypeOf<{
        name: StringType;
        profile: MapType<{ age: DoubleType }>;
        rank: DoubleType;
      }>();
    });
  });

  describe('__name__', () => {
    it('is dropped when selected alone', () => {
      expectTypeOf<BuildSelectionSchema<Schema, ['__name__']>>().toEqualTypeOf<{}>();
    });

    it('is dropped when mixed with other selections', () => {
      expectTypeOf<BuildSelectionSchema<Schema, ['__name__', 'name']>>().toEqualTypeOf<{
        name: StringType;
      }>();
    });
  });

  describe('ExpressionWithAlias', () => {
    type ScoreAlias = ExpressionWithAlias<DoubleType, 'score'>;
    type DeepAlias = ExpressionWithAlias<DoubleType, 'stats.score'>;
    type DeeperAlias = ExpressionWithAlias<StringType, 'a.b.c'>;

    it('produces a top-level entry from a non-dotted alias', () => {
      expectTypeOf<BuildSelectionSchema<Schema, [ScoreAlias]>>().toEqualTypeOf<{
        score: DoubleType;
      }>();
    });

    it('builds nested MapType layers from a dotted alias', () => {
      expectTypeOf<BuildSelectionSchema<Schema, [DeepAlias]>>().toEqualTypeOf<{
        stats: MapType<{ score: DoubleType }>;
      }>();
    });

    it('builds multi-level nesting from deeper aliases', () => {
      expectTypeOf<BuildSelectionSchema<Schema, [DeeperAlias]>>().toEqualTypeOf<{
        a: MapType<{ b: MapType<{ c: StringType }> }>;
      }>();
    });

    it('merges multiple aliases sharing a parent', () => {
      type AgeAlias = ExpressionWithAlias<DoubleType, 'stats.age'>;
      expectTypeOf<BuildSelectionSchema<Schema, [DeepAlias, AgeAlias]>>().toEqualTypeOf<{
        stats: MapType<{ score: DoubleType; age: DoubleType }>;
      }>();
    });
  });

  describe('mixed string and ExpressionWithAlias', () => {
    type ScoreAlias = ExpressionWithAlias<DoubleType, 'score'>;
    type ProfileExtraAlias = ExpressionWithAlias<StringType, 'profile.computed'>;

    it('combines a string path and a top-level alias', () => {
      expectTypeOf<BuildSelectionSchema<Schema, ['name', ScoreAlias]>>().toEqualTypeOf<{
        name: StringType;
        score: DoubleType;
      }>();
    });

    it('deep-merges an alias into the same parent as a string path', () => {
      expectTypeOf<
        BuildSelectionSchema<Schema, ['profile.age', ProfileExtraAlias]>
      >().toEqualTypeOf<{ profile: MapType<{ age: DoubleType; computed: StringType }> }>();
    });

    it('last-wins: an aliased child path after its parent replaces the parent subtree', () => {
      // The later `profile.computed` alias conflicts with `profile` and wins.
      expectTypeOf<BuildSelectionSchema<Schema, ['profile', ProfileExtraAlias]>>().toEqualTypeOf<{
        profile: MapType<{ computed: StringType }>;
      }>();
    });
  });

  describe('properties', () => {
    type NameDouble = ExpressionWithAlias<DoubleType, 'name'>;

    it('same field name twice: the later selection wins', () => {
      expectTypeOf<BuildSelectionSchema<Schema, ['name', NameDouble]>>().toEqualTypeOf<{
        name: DoubleType;
      }>();
      expectTypeOf<BuildSelectionSchema<Schema, [NameDouble, 'name']>>().toEqualTypeOf<{
        name: StringType;
      }>();
    });

    it('a dotted path nests into maps, not a literal dotted key', () => {
      expectTypeOf<BuildSelectionSchema<Schema, ['profile.age']>>().toEqualTypeOf<{
        profile: MapType<{ age: DoubleType }>;
      }>();
      expectTypeOf<BuildSelectionSchema<Schema, ['profile.age']>>().not.toEqualTypeOf<{
        'profile.age': DoubleType;
      }>();
    });

    it('disjoint siblings under a common parent are merged', () => {
      expectTypeOf<
        BuildSelectionSchema<Schema, ['profile.age', 'profile.gender']>
      >().toEqualTypeOf<{
        profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
      }>();
    });

    it('parent then child: only the child remains (replace, not merge)', () => {
      expectTypeOf<BuildSelectionSchema<Schema, ['profile', 'profile.age']>>().toEqualTypeOf<{
        profile: MapType<{ age: DoubleType }>;
      }>();
    });

    it('child then parent: the full parent subtree remains', () => {
      expectTypeOf<BuildSelectionSchema<Schema, ['profile.age', 'profile']>>().toEqualTypeOf<{
        profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
      }>();
    });
  });
});

describe('BuildAddFieldsSchema', () => {
  describe('empty / no-op', () => {
    it('returns the context unchanged for an empty list', () => {
      expectTypeOf<BuildAddFieldsSchema<Schema, []>>().toEqualTypeOf<Schema>();
    });

    it('adding an existing top-level field by string path is a no-op', () => {
      expectTypeOf<BuildAddFieldsSchema<Schema, ['name']>>().toEqualTypeOf<Schema>();
    });

    it('adding an existing nested field by dotted path keeps siblings (no-op)', () => {
      expectTypeOf<BuildAddFieldsSchema<Schema, ['profile.age']>>().toEqualTypeOf<Schema>();
    });

    it('drops __name__ (no-op)', () => {
      expectTypeOf<BuildAddFieldsSchema<Schema, ['__name__']>>().toEqualTypeOf<Schema>();
    });
  });

  describe('adding new fields (existing fields preserved)', () => {
    type ScoreAlias = ExpressionWithAlias<DoubleType, 'score'>;

    it('appends a new top-level field', () => {
      expectTypeOf<BuildAddFieldsSchema<Schema, [ScoreAlias]>>().toEqualTypeOf<{
        name: StringType;
        profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
        rank: DoubleType;
        tag: ArrayType<StringType, [], []>;
        score: DoubleType;
      }>();
    });

    it('appends a new subtree under a new parent', () => {
      type DeepAlias = ExpressionWithAlias<DoubleType, 'stats.score'>;
      expectTypeOf<BuildAddFieldsSchema<Schema, [DeepAlias]>>().toEqualTypeOf<{
        name: StringType;
        profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
        rank: DoubleType;
        tag: ArrayType<StringType, [], []>;
        stats: MapType<{ score: DoubleType }>;
      }>();
    });

    it('appends a new field into an existing parent, keeping its siblings', () => {
      type ProfileExtraAlias = ExpressionWithAlias<StringType, 'profile.computed'>;
      expectTypeOf<BuildAddFieldsSchema<Schema, [ProfileExtraAlias]>>().toEqualTypeOf<{
        name: StringType;
        profile: MapType<{
          age: DoubleType;
          gender: LiteralType<['male', 'female']> & Optional;
          computed: StringType;
        }>;
        rank: DoubleType;
        tag: ArrayType<StringType, [], []>;
      }>();
    });
  });

  describe('overwriting existing fields (additions win)', () => {
    it('overwrites a top-level field with the added type', () => {
      type NameAlias = ExpressionWithAlias<DoubleType, 'name'>;
      expectTypeOf<BuildAddFieldsSchema<Schema, [NameAlias]>>().toEqualTypeOf<{
        name: DoubleType;
        profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
        rank: DoubleType;
        tag: ArrayType<StringType, [], []>;
      }>();
    });

    it('overwrites a nested leaf while keeping its siblings', () => {
      type AgeAlias = ExpressionWithAlias<StringType, 'profile.age'>;
      expectTypeOf<BuildAddFieldsSchema<Schema, [AgeAlias]>>().toEqualTypeOf<{
        name: StringType;
        profile: MapType<{ age: StringType; gender: LiteralType<['male', 'female']> & Optional }>;
        rank: DoubleType;
        tag: ArrayType<StringType, [], []>;
      }>();
    });
  });

  describe('multiple additions', () => {
    it('appends several new fields at once', () => {
      type ScoreAlias = ExpressionWithAlias<DoubleType, 'score'>;
      type ProfileExtraAlias = ExpressionWithAlias<StringType, 'profile.computed'>;
      expectTypeOf<BuildAddFieldsSchema<Schema, [ScoreAlias, ProfileExtraAlias]>>().toEqualTypeOf<{
        name: StringType;
        profile: MapType<{
          age: DoubleType;
          gender: LiteralType<['male', 'female']> & Optional;
          computed: StringType;
        }>;
        rank: DoubleType;
        tag: ArrayType<StringType, [], []>;
        score: DoubleType;
      }>();
    });
  });

  describe('properties (additions merge into the existing context)', () => {
    it('same field name twice among additions: the later one wins', () => {
      type NameDouble = ExpressionWithAlias<DoubleType, 'name'>;
      // The later addition (DoubleType) wins over both the earlier addition and
      // the existing context field (StringType).
      expectTypeOf<BuildAddFieldsSchema<Schema, ['name', NameDouble]>>().toEqualTypeOf<{
        name: DoubleType;
        profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
        rank: DoubleType;
        tag: ArrayType<StringType, [], []>;
      }>();
    });

    it('disjoint nested additions are merged into the same parent', () => {
      type BarAlias = ExpressionWithAlias<DoubleType, 'profile.bar'>;
      type BazAlias = ExpressionWithAlias<StringType, 'profile.baz'>;
      expectTypeOf<BuildAddFieldsSchema<Schema, [BarAlias, BazAlias]>>().toEqualTypeOf<{
        name: StringType;
        profile: MapType<{
          age: DoubleType;
          gender: LiteralType<['male', 'female']> & Optional;
          bar: DoubleType;
          baz: StringType;
        }>;
        rank: DoubleType;
        tag: ArrayType<StringType, [], []>;
      }>();
    });

    it('parent/child conflict among additions still keeps existing siblings', () => {
      // Within the args `profile.age` wins over `profile`; but addFields also
      // preserves existing context fields, so `gender` remains.
      expectTypeOf<BuildAddFieldsSchema<Schema, ['profile', 'profile.age']>>().toEqualTypeOf<{
        name: StringType;
        profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
        rank: DoubleType;
        tag: ArrayType<StringType, [], []>;
      }>();
    });
  });
});
