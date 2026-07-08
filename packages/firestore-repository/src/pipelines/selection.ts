import {
  type DocumentSchema,
  type FieldType,
  type FieldTypeOfPath,
  fieldTypeOfPath,
  map,
  type MapFieldPath,
  type MapType,
} from '../schema.js';
import type { ExpressionWithAlias } from './expression.js';

// Re-exported for consumers of the selection model; the type itself lives in
// `expression.ts` (it is produced by `Expression.as(...)`).
export type { ExpressionWithAlias } from './expression.js';

type Fields = DocumentSchema;

/**
 * A single select argument: either a data field path or an aliased expression.
 *
 * Uses {@link MapFieldPath} (data fields only), **not** the document-level
 * `DocFieldPath` — the reserved key `"__name__"` is intentionally not
 * projectable here. Projecting `"__name__"` un-aliased would preserve the row's
 * read-identity at runtime, but `select` is typed to always drop it
 * (`Id = undefined`), so allowing it would make the type lie. Keep identity
 * while reshaping via `addFields` / `removeFields`; `"__name__"` stays usable in
 * `where` / `sort` (they go through `FieldProvider`, not `Selection`). See
 * `docs/pipeline-query-identity-research.md`.
 */
export type Selection<Context extends Fields> = MapFieldPath<Context> | ExpressionWithAlias;

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
> = FoldSelections<Context, DropOverriddenSelections<Args>>;

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
      ? S extends MapFieldPath<Context>
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

// ---------------------------------------------------------------------------
// Runtime counterparts. Each helper mirrors the type-level operator of the same
// name above; `buildSelectionSchema` is the entry point used by
// `Pipeline.select` to compute the projected runtime schema.
// ---------------------------------------------------------------------------

/**
 * Runtime counterpart of {@link BuildSelectionSchema}: folds the selections
 * into the projected output schema (last-wins conflicts, nested deep-merge).
 * The result feeds the next stage's field resolution and the executors' row
 * decoding, so it must mirror the type-level result exactly — the type tests
 * in `selection.test.ts` plus the pipeline spec are the safety net for the
 * bridging assertion.
 */
export const buildSelectionSchema = <
  Context extends Fields,
  const Selections extends readonly Selection<Context>[],
>(
  schema: Context,
  selections: Selections,
): BuildSelectionSchema<Context, Selections> => {
  let result: Fields = {};
  // Right-to-left to mirror `FoldSelections`' `MergeSchemas<First, Fold<Rest>>`
  // associativity (`A` wins in `MergeSchemas`, so earlier selections win over
  // the accumulated later ones — conflicts are already dropped, this only
  // affects nothing but keeps the shapes aligned).
  for (const s of [...dropOverriddenSelections(selections)].reverse()) {
    const path = selectionPath(s);
    if (path === '__name__') {
      continue; // `PathToSchema` drops the reserved key — not a data field.
    }
    const type =
      typeof s === 'string' ? fieldTypeOfPath<Fields, string>(schema, s) : s.expression.type;
    result = mergeSchemas(pathToSchema(path, type), result);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the runtime fold mirrors the type-level `BuildSelectionSchema`, but the compiler cannot connect a runtime schema value to the type-level result
  return result as BuildSelectionSchema<Context, Selections>;
};

/**
 * Runtime counterpart of {@link DropOverriddenSelections}: keeps each selection
 * only if no later selection conflicts with it (last-wins).
 */
export const dropOverriddenSelections = <S extends string | ExpressionWithAlias>(
  selections: readonly S[],
): S[] =>
  selections.filter(
    (s, i) =>
      !selections
        .slice(i + 1)
        .some((later) => pathsConflict(selectionPath(s), selectionPath(later))),
  );

/** Runtime counterpart of {@link SelectionPath}. */
const selectionPath = (s: string | ExpressionWithAlias): string =>
  typeof s === 'string' ? s : s.alias;

/** Runtime counterpart of {@link PathsConflict}. */
const pathsConflict = (a: string, b: string): boolean =>
  a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);

/** Runtime counterpart of {@link PathToSchema}. */
const pathToSchema = (path: string, type: FieldType): Fields => {
  const dot = path.indexOf('.');
  return dot < 0
    ? { [path]: type }
    : { [path.slice(0, dot)]: map(pathToSchema(path.slice(dot + 1), type)) };
};

/** Runtime counterpart of {@link MergeSchemas} (`a` wins on non-map conflicts). */
const mergeSchemas = (a: Fields, b: Fields): Fields => {
  const result: Record<string, FieldType> = { ...b, ...a };
  for (const key of Object.keys(a)) {
    const va = a[key];
    const vb = b[key];
    if (va !== undefined && vb !== undefined && isMapType(va) && isMapType(vb)) {
      result[key] = map(mergeSchemas(va.fields, vb.fields));
    }
  }
  return result;
};

/**
 * Narrows a `FieldType` descriptor to `MapType`. `FieldType` is an open
 * structural base (`type: string`), not a closed union, so this is a `switch`
 * on a plain string with a type-predicate bridge.
 */
const isMapType = (t: FieldType): t is MapType => {
  switch (t.type) {
    case 'map':
      return true;
    default:
      return false;
  }
};
