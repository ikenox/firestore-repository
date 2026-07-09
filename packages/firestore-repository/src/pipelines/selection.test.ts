import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  array,
  type ArrayType,
  type DocumentSchema,
  double,
  type DoubleType,
  literal,
  type LiteralType,
  map,
  type MapType,
  optional,
  type Optional,
  string,
  type StringType,
} from '../schema.js';
import { field } from './expression.js';
import {
  type BuildAddFieldsSchema,
  type BuildSelectionSchema,
  buildSelectionSchema,
  type ExpressionWithAlias,
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

  // `__name__` is intentionally not a valid `Selection` (it uses `MapFieldPath`,
  // not the doc-level `DocFieldPath`) — see `Selection`'s doc comment — so there is
  // nothing to test here for `select`. It stays usable in `where` / `sort`.

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
    // `__name__` is not a valid `Selection`, so `addFields(['__name__'])` is a
    // type error rather than a no-op (see `Selection`'s doc comment).
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

// Runtime mirror of the `BuildSelectionSchema` type tests above. Each case
// asserts the SAME hand-written oracle on both sides — `toStrictEqual` checks
// the runtime value and `expectTypeOf(...).toEqualTypeOf(oracle)` checks the
// type-level computation (the function's return type IS
// `BuildSelectionSchema<...>`) — so a divergence between the type operators
// and their runtime counterparts fails one of the two assertions. This is the
// safety net for the bridging assertion inside `buildSelectionSchema`.
describe('buildSelectionSchema (runtime)', () => {
  const gender = optional(literal('male', 'female'));
  const profile = map({ age: double(), gender });
  const schema = {
    name: string(),
    profile,
    rank: double(),
    tag: array(string()),
  } satisfies DocumentSchema;

  it('returns {} for an empty selection list', () => {
    const oracle = {};
    const actual = buildSelectionSchema(schema, []);
    expect(actual).toStrictEqual(oracle);
    expectTypeOf(actual).toEqualTypeOf(oracle);
  });

  it('picks top-level fields (the exact descriptors)', () => {
    const oracle = { name: schema.name, rank: schema.rank };
    const actual = buildSelectionSchema(schema, ['name', 'rank']);
    expect(actual).toStrictEqual(oracle);
    expectTypeOf(actual).toEqualTypeOf(oracle);
  });

  it('builds a nested map from a dotted path', () => {
    const oracle = { profile: map({ age: profile.fields.age }) };
    const actual = buildSelectionSchema(schema, ['profile.age']);
    expect(actual).toStrictEqual(oracle);
    expectTypeOf(actual).toEqualTypeOf(oracle);
  });

  it('merges sibling dotted paths into one map', () => {
    const oracle = { profile: map({ age: profile.fields.age, gender }) };
    const actual = buildSelectionSchema(schema, ['profile.age', 'profile.gender']);
    expect(actual).toStrictEqual(oracle);
    expectTypeOf(actual).toEqualTypeOf(oracle);
  });

  it('resolves an aliased expression to its expression type at the alias', () => {
    const oracle = { name: schema.name, points: schema.rank };
    const actual = buildSelectionSchema(schema, ['name', field(schema.rank, 'rank').as('points')]);
    expect(actual).toStrictEqual(oracle);
    expectTypeOf(actual).toEqualTypeOf(oracle);
  });

  it('last-wins: the same output name selected twice', () => {
    const oracle = { name: schema.rank };
    const actual = buildSelectionSchema(schema, ['name', field(schema.rank, 'rank').as('name')]);
    expect(actual).toStrictEqual(oracle);
    expectTypeOf(actual).toEqualTypeOf(oracle);
  });

  it('last-wins: a child path after its parent replaces the parent subtree', () => {
    const oracle = { profile: map({ age: profile.fields.age }) };
    const actual = buildSelectionSchema(schema, ['profile', 'profile.age']);
    expect(actual).toStrictEqual(oracle);
    expectTypeOf(actual).toEqualTypeOf(oracle);
  });

  it('last-wins: a parent path after its child replaces with the full subtree', () => {
    const oracle = { profile };
    const actual = buildSelectionSchema(schema, ['profile.age', 'profile']);
    expect(actual).toStrictEqual(oracle);
    expectTypeOf(actual).toEqualTypeOf(oracle);
  });

  it("rejects '__name__' as an alias; a nested '__name__' is an ordinary key", () => {
    // The backend refuses aliasing to the reserved top-level `'__name__'`
    // (`INVALID_ARGUMENT: field name '__name__' is reserved and can not be
    // overwritten` — verified live), so it is a compile error; a nested
    // `'__name__'` segment is just a map key and passes through unchanged.

    // @ts-expect-error -- the reserved '__name__' cannot be used as an alias
    field(schema.name, 'name').as('__name__');

    const oracle = { a: map({ __name__: schema.name }) };
    const actual = buildSelectionSchema(schema, [field(schema.name, 'name').as('a.__name__')]);
    expect(actual).toStrictEqual(oracle);
    expectTypeOf(actual).toEqualTypeOf(oracle);
  });
});
