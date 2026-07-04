import type {
  DocumentSchema,
  DocFieldPath,
  FieldType,
  FieldTypeOfPath,
  MapType,
} from '../schema.js';
import { Expression } from './expression.js';

type Fields = DocumentSchema;

/** A single select argument: either an existing field path or an aliased expression. */
export type Selection<Context extends Fields> = DocFieldPath<Context> | ExpressionWithAlias;

export type ExpressionWithAlias<T extends FieldType = FieldType, Alias extends string = string> = {
  expression: Expression<T>;
  alias: Alias;
};

/**
 * Folds a tuple of selections into a single nested output schema.
 *
 * Conflicting paths follow **last-wins**: when one path equals or is a dotted
 * prefix of another (the same name twice, or `"foo"` vs `"foo.bar"`), the later
 * selection replaces the earlier one. Non-conflicting paths (e.g.
 * `"profile.age"` and `"profile.gender"`) are deep-merged into nested maps.
 */
export type BuildSelectionSchema<
  Context extends Fields,
  Args extends readonly Selection<Context>[],
> = Args extends readonly Selection<Context>[]
  ? FoldSelections<Context, DropOverriddenSelections<Args>>
  : never;

/** Merges an already conflict-free selection list into one nested schema. */
type FoldSelections<
  Context extends Fields,
  Args extends readonly unknown[],
> = Args extends readonly [infer First, ...infer Rest extends readonly unknown[]]
  ? MergeSchemas<SelectionToSchema<Context, First>, FoldSelections<Context, Rest>>
  : {};

/** The output path a selection contributes to (a field path, or an alias's path). */
type SelectionPath<S> =
  S extends ExpressionWithAlias<infer _T, infer P> ? P : S extends string ? S : never;

/** Whether two paths collide: equal, or one is a dotted prefix of the other. */
type PathsConflict<A extends string, B extends string> = A extends B
  ? true
  : B extends A
    ? true
    : A extends `${B}.${string}`
      ? true
      : B extends `${A}.${string}`
        ? true
        : false;

/** Whether `P` conflicts with the path of any later selection in `Rest`. */
type ConflictsWithLater<P extends string, Rest extends readonly unknown[]> = Rest extends readonly [
  infer R,
  ...infer RR extends readonly unknown[],
]
  ? PathsConflict<P, SelectionPath<R>> extends true
    ? true
    : ConflictsWithLater<P, RR>
  : false;

/** Drops each selection that a later, conflicting selection overrides (last-wins). */
type DropOverriddenSelections<Args extends readonly unknown[]> = Args extends readonly [
  infer First,
  ...infer Rest extends readonly unknown[],
]
  ? ConflictsWithLater<SelectionPath<First>, Rest> extends true
    ? DropOverriddenSelections<Rest>
    : [First, ...DropOverriddenSelections<Rest>]
  : [];

/**
 * Output schema of `addFields`: the existing context augmented with the added
 * fields. Unlike `select` (which keeps only the selections), `addFields` keeps
 * all existing fields; on name overlap the added field wins, matching the
 * official SDK's "overwrite existing ones" behavior.
 */
export type BuildAddFieldsSchema<
  Context extends Fields,
  Args extends readonly Selection<Context>[],
  // The `Args extends ...` guard is always true; it defers evaluation so the
  // result is accepted as a `DocumentSchema` (same trick as BuildSelectionSchema).
> = Args extends readonly Selection<Context>[]
  ? MergeSchemas<BuildSelectionSchema<Context, Args>, Context>
  : never;

/** Resolves one selection into the partial schema it contributes to the output. */
type SelectionToSchema<Context extends Fields, S> =
  S extends ExpressionWithAlias<infer T, infer P>
    ? PathToSchema<P, T>
    : S extends string
      ? S extends DocFieldPath<Context>
        ? PathToSchema<S, FieldTypeOfPath<Context, S>>
        : {}
      : {};

/**
 * Builds a single-entry schema where dots in `Path` produce nested `MapType` layers.
 * `PathToSchema<"profile.age", DoubleType>` -> `{ profile: MapType<{ age: DoubleType }> }`.
 * `"__name__"` is dropped (it is not a real document field).
 */
type PathToSchema<Path extends string, T extends FieldType> = Path extends '__name__'
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
