import { describe, expectTypeOf, it } from 'vitest';

import { expectTypedStrictEqual } from '../__test__/assertion.js';
import {
  array,
  type ArrayType,
  bool,
  type DocumentSchema,
  double,
  type DoubleType,
  int64,
  literal,
  type LiteralType,
  map,
  type MapType,
  nullable,
  optional,
  type Optional,
  string,
  type StringType,
} from '../schema.js';
import { constant, countAll, equal, field, greaterThan, sum } from './expression.js';
import {
  type BuildAddFieldsSchema,
  buildAddFieldsSchema,
  buildAggregateSchema,
  buildDistinctSchema,
  type BuildSelectionSchema,
  buildSelectionSchema,
  type ExpressionWithAlias,
} from './selection.js';

type Schema = {
  name: StringType;
  profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
  rank: DoubleType;
  tag: ArrayType<StringType>;
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
        tag: ArrayType<StringType>;
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
  describe('empty', () => {
    it('returns the context unchanged for an empty list', () => {
      expectTypeOf<BuildAddFieldsSchema<Schema, []>>().toEqualTypeOf<Schema>();
    });
  });

  describe('adding new fields (existing fields preserved)', () => {
    type ScoreAlias = ExpressionWithAlias<DoubleType, 'score'>;

    it('appends a new top-level field', () => {
      expectTypeOf<BuildAddFieldsSchema<Schema, [ScoreAlias]>>().toEqualTypeOf<{
        name: StringType;
        profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
        rank: DoubleType;
        tag: ArrayType<StringType>;
        score: DoubleType;
      }>();
    });

    it('appends a new subtree under a new parent', () => {
      type DeepAlias = ExpressionWithAlias<DoubleType, 'stats.score'>;
      expectTypeOf<BuildAddFieldsSchema<Schema, [DeepAlias]>>().toEqualTypeOf<{
        name: StringType;
        profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
        rank: DoubleType;
        tag: ArrayType<StringType>;
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
        tag: ArrayType<StringType>;
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
        tag: ArrayType<StringType>;
      }>();
    });

    it('overwrites a nested leaf while keeping its siblings', () => {
      type AgeAlias = ExpressionWithAlias<StringType, 'profile.age'>;
      expectTypeOf<BuildAddFieldsSchema<Schema, [AgeAlias]>>().toEqualTypeOf<{
        name: StringType;
        profile: MapType<{ age: StringType; gender: LiteralType<['male', 'female']> & Optional }>;
        rank: DoubleType;
        tag: ArrayType<StringType>;
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
        tag: ArrayType<StringType>;
        score: DoubleType;
      }>();
    });
  });

  describe('properties (additions merge into the existing context)', () => {
    it('same field name twice among additions: the later one wins', () => {
      type NameString = ExpressionWithAlias<StringType, 'name'>;
      type NameDouble = ExpressionWithAlias<DoubleType, 'name'>;
      // The later addition (DoubleType) wins over both the earlier addition and
      // the existing context field (StringType).
      expectTypeOf<BuildAddFieldsSchema<Schema, [NameString, NameDouble]>>().toEqualTypeOf<{
        name: DoubleType;
        profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
        rank: DoubleType;
        tag: ArrayType<StringType>;
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
        tag: ArrayType<StringType>;
      }>();
    });

    it('parent/child conflict among additions still keeps existing siblings', () => {
      type ProfileAlias = ExpressionWithAlias<
        MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>,
        'profile'
      >;
      type AgeAlias = ExpressionWithAlias<DoubleType, 'profile.age'>;
      // Within the args `profile.age` wins over `profile`; but addFields also
      // preserves existing context fields, so `gender` remains.
      expectTypeOf<BuildAddFieldsSchema<Schema, [ProfileAlias, AgeAlias]>>().toEqualTypeOf<{
        name: StringType;
        profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
        rank: DoubleType;
        tag: ArrayType<StringType>;
      }>();
    });
  });
});

// Runtime mirror of the `BuildSelectionSchema` type tests above. Each case
// pins the SAME hand-written oracle on both sides via
// `expectTypedStrictEqual` — the runtime value and the type-level computation
// (the function's return type IS `BuildSelectionSchema<...>`) — so a
// divergence between the type operators and their runtime counterparts fails
// the assertion. This is the safety net for the bridging assertion inside
// `buildSelectionSchema`.
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
    expectTypedStrictEqual(actual, oracle);
  });

  it('picks top-level fields (the exact descriptors)', () => {
    const oracle = { name: schema.name, rank: schema.rank };
    const actual = buildSelectionSchema(schema, ['name', 'rank']);
    expectTypedStrictEqual(actual, oracle);
  });

  it('builds a nested map from a dotted path', () => {
    const oracle = { profile: map({ age: profile.fields.age }) };
    const actual = buildSelectionSchema(schema, ['profile.age']);
    expectTypedStrictEqual(actual, oracle);
  });

  it('merges sibling dotted paths into one map', () => {
    const oracle = { profile: map({ age: profile.fields.age, gender }) };
    const actual = buildSelectionSchema(schema, ['profile.age', 'profile.gender']);
    expectTypedStrictEqual(actual, oracle);
  });

  it('resolves an aliased expression to its expression type at the alias', () => {
    const oracle = { name: schema.name, points: schema.rank };
    const actual = buildSelectionSchema(schema, ['name', field(schema.rank, 'rank').as('points')]);
    expectTypedStrictEqual(actual, oracle);
  });

  it('last-wins: the same output name selected twice', () => {
    const oracle = { name: schema.rank };
    const actual = buildSelectionSchema(schema, ['name', field(schema.rank, 'rank').as('name')]);
    expectTypedStrictEqual(actual, oracle);
  });

  it('last-wins: a child path after its parent replaces the parent subtree', () => {
    const oracle = { profile: map({ age: profile.fields.age }) };
    const actual = buildSelectionSchema(schema, ['profile', 'profile.age']);
    expectTypedStrictEqual(actual, oracle);
  });

  it('last-wins: a parent path after its child replaces with the full subtree', () => {
    const oracle = { profile };
    const actual = buildSelectionSchema(schema, ['profile.age', 'profile']);
    expectTypedStrictEqual(actual, oracle);
  });

  it('addFields: keeps the context and adds the selection schema on top', () => {
    const oracle = {
      name: schema.name,
      profile,
      rank: schema.rank,
      tag: schema.tag,
      points: schema.rank,
    };
    const actual = buildAddFieldsSchema(schema, [field(schema.rank, 'rank').as('points')]);
    expectTypedStrictEqual(actual, oracle);
  });

  it('addFields: an added field wins over an existing one on name overlap', () => {
    const oracle = { name: schema.name, profile, rank: schema.name, tag: schema.tag };
    const actual = buildAddFieldsSchema(schema, [field(schema.name, 'name').as('rank')]);
    expectTypedStrictEqual(actual, oracle);
  });

  it('addFields: a dotted alias deep-merges into the existing map', () => {
    const oracle = {
      name: schema.name,
      profile: map({ author: schema.name, age: profile.fields.age, gender }),
      rank: schema.rank,
      tag: schema.tag,
    };
    const actual = buildAddFieldsSchema(schema, [field(schema.name, 'name').as('profile.author')]);
    expectTypedStrictEqual(actual, oracle);
  });

  it('propagates an ancestor Optional marker to the selected leaf', () => {
    const s = { name: string(), meta: optional(map({ x: double() })) } satisfies DocumentSchema;
    // The backend materializes intermediate layers and omits only the leaf, so
    // the projected `meta` is required while `x` becomes optional.
    const oracle = { meta: map({ x: optional(double()) }) };
    const actual = buildSelectionSchema(s, ['meta.x']);
    expectTypedStrictEqual(actual, oracle);
  });

  it('propagates a mid-path Optional marker from deeper nesting', () => {
    const s = { a: map({ b: optional(map({ c: double() })) }) } satisfies DocumentSchema;
    // The optional segment is in the middle: output layers are required maps,
    // only the leaf carries the conditionality.
    const oracle = { a: map({ b: map({ c: optional(double()) }) }) };
    const actual = buildSelectionSchema(s, ['a.b.c']);
    expectTypedStrictEqual(actual, oracle);
  });

  it('marks an aliased Field of a conditional path optional; computed expressions stay required', () => {
    const s = { name: string(), meta: optional(map({ x: double() })) } satisfies DocumentSchema;

    const aliased = buildSelectionSchema(s, [field(s.meta.fields.x, 'meta.x').as('mx')]);
    const aliasedOracle = { mx: optional(double()) };
    expectTypedStrictEqual(aliased, aliasedOracle);

    // A computed expression always produces a value — no conditionality.
    const computed = buildSelectionSchema(s, [
      equal(field(s.meta.fields.x, 'meta.x'), constant(1)).as('isOne'),
    ]);
    const computedOracle = { isOne: bool() };
    expectTypedStrictEqual(computed, computedOracle);
  });

  it('selecting a whole optional map keeps the key itself optional', () => {
    const s = { name: string(), meta: optional(map({ x: double() })) } satisfies DocumentSchema;
    // Whole-key selection: absence stays on the key (the backend omits it),
    // not on the leaves inside.
    const oracle = { meta: s.meta };
    const actual = buildSelectionSchema(s, ['meta']);
    expectTypedStrictEqual(actual, oracle);
  });

  it("treats '__name__' in an alias like any other key (no special-casing)", () => {
    // The reserved-name rule is deliberately not modelled client-side:
    // aliasing to top-level `'__name__'` is rejected by the backend itself
    // (`INVALID_ARGUMENT`, verified live), and a nested `'__name__'` segment
    // is an ordinary map key there — so the schema fold treats both as plain
    // keys. See `ExpressionBase.as`.
    const oracle = { a: map({ __name__: schema.name }) };
    const actual = buildSelectionSchema(schema, [field(schema.name, 'name').as('a.__name__')]);
    expectTypedStrictEqual(actual, oracle);
  });
});

// Stage-schema synthesis of the `aggregate` stage. Each case pins one
// hand-written oracle on BOTH sides via `expectTypedStrictEqual` — the runtime
// value and the type-level computation (the return type IS
// `AggregateSchema<...>`) — the safety net for the bridging assertion inside
// `buildAggregateSchema`. Oracles derive from the
// `AggregateSchema` operators: `AccumulatorSchema` merged (A-wins) on top of
// `AbsentMergesIntoNull<BuildSelectionSchema<groups>>`.
describe('buildAggregateSchema (runtime)', () => {
  const gender = optional(literal('male', 'female'));
  const profile = map({ age: double(), gender });
  const schema = {
    name: string(),
    g: string(),
    opt: optional(string()),
    profile,
    rank: double(),
  } satisfies DocumentSchema;

  const total = sum(field(schema.rank, 'rank')).as('total');
  const n = countAll().as('n');

  it('accumulators only (no groups): a flat alias -> descriptor record', () => {
    // sum(double) is nullable (the empty no-groups row carries null); countAll
    // is a plain int64 (0, never null).
    const oracle = { total: nullable(double()), n: int64() };
    const actual = buildAggregateSchema(schema, [total, n]);
    expectTypedStrictEqual(actual, oracle);
  });

  it('a bare-path group key passes through unchanged (non-optional stays as-is)', () => {
    const oracle = { n: int64(), g: string() };
    const actual = buildAggregateSchema(schema, [n], ['g']);
    expectTypedStrictEqual(actual, oracle);
  });

  it('an aliased-expression group projects the expression at its alias', () => {
    const oracle = { n: int64(), big: bool() };
    const actual = buildAggregateSchema(
      schema,
      [n],
      [greaterThan(field(schema.rank, 'rank'), constant(4)).as('big')],
    );
    expectTypedStrictEqual(actual, oracle);
  });

  it('a top-level optional group key merges absent into null (nullable, never absent)', () => {
    // null and absent group keys merge into ONE null group (probed) — the
    // `& Optional` field is rewritten to nullable.
    const oracle = { n: int64(), opt: nullable(string()) };
    const actual = buildAggregateSchema(schema, [n], ['opt']);
    expectTypedStrictEqual(actual, oracle);
  });

  it('a nested field groups via an EXPRESSION with a top-level alias; dotted forms are rejected', () => {
    // The backend rejects dotted assignment targets in aggregate
    // (TOP_LEVEL_PROPERTY_PATH_ONLY — probed): no dotted bare-path groups, no
    // dotted aliases. A nested field groups through an expression whose alias
    // is top-level; the optional LEAF still reads back nullable.
    const genderField = field(gender, 'profile.gender');
    const oracle = { n: int64(), gender: nullable(literal('male', 'female')) };
    const actual = buildAggregateSchema(schema, [n], [genderField.as('gender')]);
    expectTypedStrictEqual(actual, oracle);
  });

  it('a REQUIRED leaf under an optional ancestor reads back nullable (via the expression form)', () => {
    // The a?.b.c shape: the leaf's nullability comes from the path CROSSING an
    // optional ancestor (`WithConditionality`), not from the leaf's own
    // marker — a distinct matrix cell from the leaf-optional case above.
    // Probed live: field('a.b.c').as('c') groups the nested value and the
    // absent-ancestor rows land in the null group.
    const deep = { a: optional(map({ b: map({ c: string() }) })), n: int64() };
    const nAcc = countAll().as('n');
    const cField = field(string(), 'a.b.c');
    const oracle = { n: int64(), c: nullable(string()) };
    const actual = buildAggregateSchema(deep, [nAcc], [cField.as('c')]);
    expectTypedStrictEqual(actual, oracle);
  });

  it('a MAP-typed group key keeps its INNER absences; only the whole-map absence merges', () => {
    // Probed: { b: {} } and { b: { c: 'v1' } } form DISTINCT groups (the map
    // is compared and projected as a value), while a wholly-absent map merges
    // into the null group — so the rewrite is SHALLOW: nullable at the top,
    // inner optionality preserved.
    const deep = { a: optional(map({ b: map({ c: optional(string()) }) })), n: int64() };
    const nAcc = countAll().as('n');
    const oracle = { n: int64(), a: nullable(map({ b: map({ c: optional(string()) }) })) };
    const actual = buildAggregateSchema(deep, [nAcc], ['a']);
    expectTypedStrictEqual(actual, oracle);
  });

  it('dotted group forms are rejected at the type level', () => {
    void (() => {
      const nAcc = countAll().as('n');
      // @ts-expect-error -- a dotted BARE path is not a top-level group key
      void buildAggregateSchema(schema, [nAcc], ['profile.gender']);
      // @ts-expect-error -- a dotted accumulator alias is rejected (TOP_LEVEL_PROPERTY_PATH_ONLY)
      void countAll().as('agg.cnt');
    });
  });

  it('an accumulator alias colliding with a group name wins', () => {
    // `MergeSchemas` puts the accumulator record first, so its `g` overlays the
    // group key `g` — the accumulator is the more specific intent.
    const oracle = { g: int64() };
    const actual = buildAggregateSchema(schema, [countAll().as('g')], ['g']);
    expectTypedStrictEqual(actual, oracle);
  });
});

// Stage-schema synthesis of the `distinct` stage. `distinct` is a grouped
// aggregate with ZERO accumulators, so its schema IS the group half —
// `DistinctSchema` reuses the very `GroupSchema` operator that
// `AggregateSchema` merges its accumulators onto. The per-cell group-projection
// matrix (bare key, aliased expression, nested-via-expression, optional leaf,
// required-leaf-under-optional-ancestor, map-typed shallow rewrite) is already
// exercised exhaustively by `buildAggregateSchema (runtime)` above, so here we
// cover the distinct-SPECIFIC surface — the schema is EXACTLY the group keys
// (no accumulator record overlaid) and multiple groups compose — plus one
// representative shared-path case (optional -> nullable) that proves
// `absentMergesIntoNull` runs, and the type-level dotted-group rejections.
// Each case pins one oracle on BOTH sides via `expectTypedStrictEqual` (the
// return type IS `DistinctSchema<...>`), the safety net for the bridging
// assertion inside `buildDistinctSchema`.
describe('buildDistinctSchema (runtime)', () => {
  const gender = optional(literal('male', 'female'));
  const profile = map({ age: double(), gender });
  const schema = {
    name: string(),
    g: string(),
    opt: optional(string()),
    profile,
    rank: double(),
  } satisfies DocumentSchema;

  it('a single bare-path group is the whole schema (no accumulator record)', () => {
    // The distinct-specific shape: unlike aggregate, nothing is overlaid — the
    // result is exactly the group key.
    const oracle = { g: string() };
    const actual = buildDistinctSchema(schema, ['g']);
    expectTypedStrictEqual(actual, oracle);
  });

  it('a top-level optional group key merges absent into null (representative shared path)', () => {
    // null and absent keys merge into ONE null row (probed) — the `& Optional`
    // field is rewritten to nullable. This exercises the `GroupSchema` path
    // shared with aggregate.
    const oracle = { opt: nullable(string()) };
    const actual = buildDistinctSchema(schema, ['opt']);
    expectTypedStrictEqual(actual, oracle);
  });

  it('multiple groups compose (bare key + aliased expression)', () => {
    const oracle = { g: string(), big: bool() };
    const actual = buildDistinctSchema(schema, [
      'g',
      greaterThan(field(schema.rank, 'rank'), constant(4)).as('big'),
    ]);
    expectTypedStrictEqual(actual, oracle);
  });

  it('a MAP-typed group key keeps its INNER absences; only the whole-map absence merges', () => {
    // Probed: the map is compared and projected as a VALUE, so the rewrite is
    // SHALLOW — nullable at the top, inner optionality preserved.
    const deep = {
      a: optional(map({ b: map({ c: optional(string()) }) })),
    } satisfies DocumentSchema;
    const oracle = { a: nullable(map({ b: map({ c: optional(string()) }) })) };
    const actual = buildDistinctSchema(deep, ['a']);
    expectTypedStrictEqual(actual, oracle);
  });

  it('a dotted bare-path group is rejected at the type level', () => {
    // A dotted bare path is not a top-level group key (TOP_LEVEL_PROPERTY_PATH_ONLY).
    // The complementary dotted-ALIAS rejection is enforced one level up, at the
    // `Pipeline.distinct` parameter via `UndottedGroupAliases` (expression `.as`
    // itself allows dotted aliases, for `select`/`addFields` nesting) — asserted
    // in `pipeline.test.ts`.
    void (() => {
      // @ts-expect-error -- a dotted BARE path is not a top-level group key
      void buildDistinctSchema(schema, ['profile.gender']);
    });
  });
});
