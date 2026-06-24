import { describe, expectTypeOf, it } from "vitest";

import { authorsCollection } from "./__test__/specification.js";
import {
  BuildSelection,
  equal,
  ExpressionWithAlias,
  Pipeline,
  pipelineQuery,
  constant,
} from "./pipeline-query.js";
import type {
  ArrayType,
  DoubleType,
  LiteralType,
  MapType,
  Optional,
  StringType,
} from "./schema.js";

describe("pipeline-query", () => {
  const base = pipelineQuery(authorsCollection);

  it("where", () => {
    base.where((field) =>
      equal(field("profile"), constant({ gender: "female", age: 20 })),
    );
  });

  it("select", () => {
    base.select((field) => [
      "profile.gender",
      field("name"),
      field("name"),
      equal(1, 2),
    ]);
  });

  it("wip", () => {
    expectTypeOf(base).toEqualTypeOf<
      Pipeline<{
        name: StringType;
        profile: MapType<{
          age: DoubleType;
          gender: LiteralType<["male", "female"]> & Optional;
        }>;
        rank: DoubleType;
        tag: ArrayType<StringType, [], []>;
      }>
    >();
    expectTypeOf(base.select("name")).toEqualTypeOf<
      Pipeline<{ name: StringType }>
    >();
    expectTypeOf(base.select("name", "tag")).toEqualTypeOf<
      Pipeline<{ name: StringType; tag: ArrayType<StringType, [], []> }>
    >();
    expectTypeOf(base.select("profile")).toEqualTypeOf<
      Pipeline<{
        profile: MapType<{
          age: DoubleType;
          gender: LiteralType<["male", "female"]> & Optional;
        }>;
      }>
    >();
    expectTypeOf(base.select("profile.age")).toEqualTypeOf<
      Pipeline<{ profile: MapType<{ age: DoubleType }> }>
    >();

    // FIXME
    expectTypeOf(base.select("__name__")).toEqualTypeOf<Pipeline<{}>>();

    expectTypeOf(base.removeFields("name")).toEqualTypeOf<
      Pipeline<{
        profile: MapType<{
          age: DoubleType;
          gender: LiteralType<["male", "female"]> & Optional;
        }>;
        rank: DoubleType;
        tag: ArrayType<StringType, [], []>;
      }>
    >();
    expectTypeOf(base.removeFields("name", "profile.age")).toEqualTypeOf<
      Pipeline<{
        profile: MapType<{
          gender: LiteralType<["male", "female"]> & Optional;
        }>;
        rank: DoubleType;
        tag: ArrayType<StringType, [], []>;
      }>
    >();
  });

  describe("BuildSelection", () => {
    type Schema = {
      name: StringType;
      profile: MapType<{
        age: DoubleType;
        gender: LiteralType<["male", "female"]> & Optional;
      }>;
      rank: DoubleType;
      tag: ArrayType<StringType, [], []>;
    };

    describe("empty", () => {
      it("returns {} for an empty selection list", () => {
        expectTypeOf<BuildSelection<Schema, []>>().toEqualTypeOf<{}>();
      });
    });

    describe("string paths", () => {
      it("picks a top-level field", () => {
        expectTypeOf<BuildSelection<Schema, ["name"]>>().toEqualTypeOf<{
          name: StringType;
        }>();
      });

      it("picks a top-level subtree as a MapType", () => {
        expectTypeOf<BuildSelection<Schema, ["profile"]>>().toEqualTypeOf<{
          profile: MapType<{
            age: DoubleType;
            gender: LiteralType<["male", "female"]> & Optional;
          }>;
        }>();
      });

      it("builds a nested MapType from a dotted path", () => {
        expectTypeOf<BuildSelection<Schema, ["profile.age"]>>().toEqualTypeOf<{
          profile: MapType<{ age: DoubleType }>;
        }>();
      });

      it("preserves the Optional marker at the leaf of a dotted path", () => {
        expectTypeOf<
          BuildSelection<Schema, ["profile.gender"]>
        >().toEqualTypeOf<{
          profile: MapType<{
            gender: LiteralType<["male", "female"]> & Optional;
          }>;
        }>();
      });

      it("merges disjoint top-level selections", () => {
        expectTypeOf<BuildSelection<Schema, ["name", "tag"]>>().toEqualTypeOf<{
          name: StringType;
          tag: ArrayType<StringType, [], []>;
        }>();
      });

      it("deep-merges siblings under a common parent", () => {
        expectTypeOf<
          BuildSelection<Schema, ["profile.age", "profile.gender"]>
        >().toEqualTypeOf<{
          profile: MapType<{
            age: DoubleType;
            gender: LiteralType<["male", "female"]> & Optional;
          }>;
        }>();
      });

      it("keeps the full subtree when a parent and its child are both selected", () => {
        // The whole `profile` subtree is selected first, and the later dotted path
        // does not strip siblings (MergeSchemas deep-merges MapType fields).
        expectTypeOf<
          BuildSelection<Schema, ["profile", "profile.age"]>
        >().toEqualTypeOf<{
          profile: MapType<{
            age: DoubleType;
            gender: LiteralType<["male", "female"]> & Optional;
          }>;
        }>();
      });

      it("merges three selections covering both top-level and nested", () => {
        expectTypeOf<
          BuildSelection<Schema, ["name", "profile.age", "rank"]>
        >().toEqualTypeOf<{
          name: StringType;
          profile: MapType<{ age: DoubleType }>;
          rank: DoubleType;
        }>();
      });
    });

    describe("__name__", () => {
      it("is dropped when selected alone", () => {
        expectTypeOf<
          BuildSelection<Schema, ["__name__"]>
        >().toEqualTypeOf<{}>();
      });

      it("is dropped when mixed with other selections", () => {
        expectTypeOf<
          BuildSelection<Schema, ["__name__", "name"]>
        >().toEqualTypeOf<{
          name: StringType;
        }>();
      });
    });

    describe("ExpressionWithAlias", () => {
      type ScoreAlias = ExpressionWithAlias<DoubleType, "score">;
      type DeepAlias = ExpressionWithAlias<DoubleType, "stats.score">;
      type DeeperAlias = ExpressionWithAlias<StringType, "a.b.c">;

      it("produces a top-level entry from a non-dotted alias", () => {
        expectTypeOf<BuildSelection<Schema, [ScoreAlias]>>().toEqualTypeOf<{
          score: DoubleType;
        }>();
      });

      it("builds nested MapType layers from a dotted alias", () => {
        expectTypeOf<BuildSelection<Schema, [DeepAlias]>>().toEqualTypeOf<{
          stats: MapType<{ score: DoubleType }>;
        }>();
      });

      it("builds multi-level nesting from deeper aliases", () => {
        expectTypeOf<BuildSelection<Schema, [DeeperAlias]>>().toEqualTypeOf<{
          a: MapType<{ b: MapType<{ c: StringType }> }>;
        }>();
      });

      it("merges multiple aliases sharing a parent", () => {
        type AgeAlias = ExpressionWithAlias<DoubleType, "stats.age">;
        expectTypeOf<
          BuildSelection<Schema, [DeepAlias, AgeAlias]>
        >().toEqualTypeOf<{
          stats: MapType<{ score: DoubleType; age: DoubleType }>;
        }>();
      });
    });

    describe("mixed string and ExpressionWithAlias", () => {
      type ScoreAlias = ExpressionWithAlias<DoubleType, "score">;
      type ProfileExtraAlias = ExpressionWithAlias<
        StringType,
        "profile.computed"
      >;

      it("combines a string path and a top-level alias", () => {
        expectTypeOf<
          BuildSelection<Schema, ["name", ScoreAlias]>
        >().toEqualTypeOf<{
          name: StringType;
          score: DoubleType;
        }>();
      });

      it("deep-merges an alias into the same parent as a string path", () => {
        expectTypeOf<
          BuildSelection<Schema, ["profile.age", ProfileExtraAlias]>
        >().toEqualTypeOf<{
          profile: MapType<{ age: DoubleType; computed: StringType }>;
        }>();
      });

      it("deep-merges an alias into a subtree taken as a string", () => {
        // `profile` brings the full subtree; the alias appends `computed`.
        expectTypeOf<
          BuildSelection<Schema, ["profile", ProfileExtraAlias]>
        >().toEqualTypeOf<{
          profile: MapType<{
            age: DoubleType;
            gender: LiteralType<["male", "female"]> & Optional;
            computed: StringType;
          }>;
        }>();
      });
    });
  });
});
