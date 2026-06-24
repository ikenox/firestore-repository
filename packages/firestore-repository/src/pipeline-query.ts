import {
  bool,
  BoolType,
  Collection,
  DocumentSchema,
  FieldPath,
  FieldType,
  FieldTypeOfPath,
  FieldValue,
  MapType,
  OmitPaths,
} from "./schema.js";

type Fields = DocumentSchema;

export type Stage =
  | { kind: "input" }
  | { kind: "where" }
  | { kind: "select" }
  | { kind: "aggregate" }
  | { kind: "distinct" };

export type FieldProvider<Context extends Fields> = <
  Path extends FieldPath<Context>,
>(
  path: Path,
) => Field<FieldTypeOfPath<Context, Path>, Path>;

export type Expression<T extends FieldType> = {
  kind: "expression";
  type: T;
  detail: Equal;
};

export const equal = <T extends Field>(
  field: T,
  value: FieldValue<T["type"], "read">,
): Expression<BoolType> => ({
  kind: "expression",
  type: bool(),
  detail: { kind: "equal", field, value },
});

export type Equal = { kind: "equal"; field: Field; value: unknown };

export type Field<
  T extends FieldType = FieldType,
  Path extends string = string,
> = {
  type: T;
  path: Path;
};

export type ExpressionWithAlias<
  T extends FieldType = FieldType,
  Path extends string = string,
> = {
  type: T;
  path: Path;
};

export class PipelineQuery<Context extends Fields> {
  constructor(
    readonly schema: Context,
    readonly stage: Stage,
    readonly parent?: PipelineQuery<Fields>,
  ) {}

  where(
    condition: (field: FieldProvider<Context>) => Expression<BoolType>,
  ): PipelineQuery<Context> {
    return 1 as any;
  }
  select<const Selections extends readonly Selection<Context>[]>(
    ...selections: Selections
  ): PipelineQuery<BuildSelection<Context, Selections>> {
    return 1 as any;
  }
  addFields() {}
  removeFields<const U extends FieldPath<Context>[]>(
    ...fields: U
  ): PipelineQuery<OmitPaths<Context, U[number]>> {
    return 1 as any;
  }
  aggregate(): PipelineQuery<Fields> {
    return 1 as any;
  }
  distinct(): PipelineQuery<Fields> {
    return 1 as any;
  }
}

export const pipelineQuery = <T extends Collection>(
  collection: T,
): PipelineQuery<T["schema"]> => ({}) as any;

/** A single select argument: either an existing field path or an aliased expression. */
type Selection<Context extends Fields> =
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
