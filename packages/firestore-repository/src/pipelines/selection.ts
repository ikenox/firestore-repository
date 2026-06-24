import type {
  DocumentSchema,
  FieldPath,
  FieldType,
  FieldTypeOfPath,
  MapType,
} from "../schema.js";
import { Expression } from "./expression.js";

type Fields = DocumentSchema;

export type ExpressionWithAlias<
  T extends FieldType = FieldType,
  Path extends string = string,
> = {
  expression: Expression<T>;
  path: Path;
};

/** A single select argument: either an existing field path or an aliased expression. */
export type Selection<Context extends Fields> =
  | FieldPath<Context>
  | ExpressionWithAlias;

/** Folds a tuple of selections into a single nested schema via `MergeSchemas`. */
export type BuildSelection<
  Context extends Fields,
  Args extends readonly Selection<Context>[],
> = Args extends readonly [
  infer First,
  ...infer Rest extends readonly Selection<Context>[],
]
  ? MergeSchemas<
      SelectionToSchema<Context, First>,
      BuildSelection<Context, Rest>
    >
  : {};

/** Resolves one selection into the partial schema it contributes to the output. */
type SelectionToSchema<Context extends Fields, S> =
  S extends ExpressionWithAlias<infer T, infer P>
    ? PathToSchema<P, T>
    : S extends string
      ? S extends FieldPath<Context>
        ? PathToSchema<S, FieldTypeOfPath<Context, S>>
        : {}
      : {};

/**
 * Builds a single-entry schema where dots in `Path` produce nested `MapType` layers.
 * `PathToSchema<"profile.age", DoubleType>` -> `{ profile: MapType<{ age: DoubleType }> }`.
 * `"__name__"` is dropped (it is not a real document field).
 */
type PathToSchema<
  Path extends string,
  T extends FieldType,
> = Path extends "__name__"
  ? {}
  : Path extends `${infer Head}.${infer Rest}`
    ? { [K in Head]: MapType<PathToSchema<Rest, T>> }
    : { [K in Path]: T };

/**
 * Recursively merges two schemas. When the same key carries a `MapType` on both
 * sides, the nested fields are merged; otherwise the value from `A` wins.
 */
type MergeSchemas<A, B> = {
  [K in keyof A | keyof B]: K extends keyof A
    ? K extends keyof B
      ? A[K] extends MapType<infer FA>
        ? B[K] extends MapType<infer FB>
          ? MapType<MergeSchemas<FA, FB>>
          : A[K]
        : A[K]
      : A[K]
    : K extends keyof B
      ? B[K]
      : never;
};
