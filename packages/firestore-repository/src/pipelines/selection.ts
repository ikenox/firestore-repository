import {
  type DocumentSchema,
  type FieldType,
  type FieldTypeOfPath,
  fieldTypeOfPath,
  int64,
  type Int64Type,
  isMapType,
  map,
  type MapFieldPath,
  type MapType,
  nullable,
  type NullType,
  type Optional,
  optional,
  type Normalize,
} from '../schema.js';
import { assertNever } from '../util.js';
import {
  type AggregateWithAlias,
  type ArrayElementType,
  arrayElementType,
  type ArrayValued,
  type ExpressionWithAlias,
  type Field,
  type PreserveOptional,
  preserveOptional,
  type PropagateNull,
  propagateNullType,
  type UndottedKey,
  type WithoutOptional,
  withoutOptional,
} from './expression.js';

// Re-exported for consumers of the selection model; the type itself lives in
// `expression.ts` (it is produced by `Expression.as(...)`).
export type { ExpressionWithAlias } from './expression.js';

type Fields = DocumentSchema;

/**
 * A single select argument: a data field path, a bare {@link Field}, or an
 * aliased expression.
 *
 * A bare `Field` needs no `.as(...)`: a `Field<T, Path>` is inherently aliased —
 * its `path` IS its output name — which is why the official SDK's `Field`
 * implements `Selectable`. So `select((f) => [f('profile.age')])` and
 * `select(() => ['profile.age'])` produce the same schema, and the two forms
 * conflict-resolve against each other as one and the same output path.
 *
 * Uses {@link MapFieldPath} (data fields only) for BOTH bare forms, **not** the
 * document-level `DocFieldPath` — the reserved key `"__name__"` is
 * intentionally not projectable here, whether written as a string or as
 * `f('__name__')`. Projecting `"__name__"` un-aliased would preserve the row's
 * read-identity at runtime, but `select` is typed to always drop it
 * (`Id = undefined`), so allowing it would make the type lie. Keep identity
 * while reshaping via `addFields` / `removeFields`; `"__name__"` stays usable in
 * `where` / `sort` (they go through `FieldProvider`, not `Selection`). See
 * `docs/pipeline-query-identity-research.md`.
 */
export type Selection<Context extends Fields> =
  | MapFieldPath<Context>
  | BareField<Context>
  | ExpressionWithAlias;

/**
 * A group selection of the `aggregate` stage: a TOP-LEVEL bare field path, a
 * bare {@link Field} whose path is top-level, or an aliased expression whose
 * alias is undotted. The backend rejects dotted assignment targets in
 * `aggregate` (`TOP_LEVEL_PROPERTY_PATH_ONLY` — probed: a dotted bare path, a
 * dotted bare `Field` and a dotted alias are all INVALID_ARGUMENT), so unlike
 * `select`'s {@link Selection} there is no nested output form — group a
 * NESTED field via an expression with a top-level alias:
 * `field('a.b.c').as('c')`.
 *
 * A bare `Field` is accepted here for the same reason as in {@link Selection}
 * (its `path` is its alias — probed: an unaliased top-level `field('g')` groups
 * under the row key `g`). Its top-level restriction is NOT expressed in this
 * union but in the {@link UndottedGroupAliases} tuple guard, so a dotted bare
 * `Field` and a dotted alias fail the same way.
 */
export type AggregateGroup<Context extends Fields> =
  | (keyof Context & string)
  | BareField<Context>
  | ExpressionWithAlias;

/**
 * A `Field` usable as an un-aliased selection: any of the context's **data**
 * field paths. `'__name__'` is excluded so the bare `Field` form allows exactly
 * what the bare string form allows (see {@link Selection}) — `FieldProvider`
 * itself resolves the reserved key, so the exclusion has to happen here.
 */
type BareField<Context extends Fields> = Field<FieldType, MapFieldPath<Context>>;

/**
 * The context-free shape of a single selection, as the stage payloads and the
 * runtime folds see it: a bare field path, a bare `Field`, or an aliased
 * expression. The type-erased counterpart of {@link Selection} /
 * {@link AggregateGroup} — the context-dependent narrowing (which paths are
 * legal, which output names are top-level) has already been discharged by the
 * typed `Pipeline` methods, so nothing downstream needs to re-check it.
 */
export type SelectionNode = string | Field | ExpressionWithAlias;

/**
 * The top-level-output guard for a groups tuple (applied as a parameter
 * intersection, the `WithoutDottedKeys` precedent): a group whose output name
 * contains the path separator collapses to `never` — an aliased group by its
 * `alias`, a bare {@link Field} by its `path` (which is its alias). Both
 * collapse through this one guard so the two dotted forms produce the same
 * error at the same place.
 *
 * The bare STRING form needs no guard: {@link AggregateGroup} already narrows it
 * to `keyof Context`, which is dot-free by construction
 * (`WithoutDottedFieldNames`).
 */
export type UndottedGroupAliases<G> = {
  [I in keyof G]: UndottedSelectionAlias<G[I]>;
};

/**
 * The top-level-output guard for a SINGLE selection — the scalar core
 * {@link UndottedGroupAliases} maps over a tuple, and the guard
 * `Pipeline.unnest` applies to its lone `selectable` (whose alias and whose
 * `indexField` are both restricted to top level — probed, both INVALID_ARGUMENT
 * when dotted).
 *
 * A selection whose output name contains the path separator collapses to
 * `never`: an aliased selection by its `alias`, a bare {@link Field} by its
 * `path` (which is its alias). Sharing this one operator is what makes the two
 * dotted forms produce the same error at the same place, in every stage whose
 * outputs are top-level-only.
 */
export type UndottedSelectionAlias<S> = S extends { alias: infer A extends string }
  ? A extends `${string}.${string}`
    ? never
    : S
  : S extends Field<FieldType, infer P>
    ? P extends `${string}.${string}`
      ? never
      : S
    : S;

/**
 * The top-level-output guard for an `unnest` index field: `undefined` (no index
 * field) passes through, a name passes through {@link UndottedKey}. A separate
 * operator from {@link UndottedSelectionAlias} only because the value is a bare
 * key rather than a selection — the restriction is the same one.
 */
export type UndottedIndexField<Index extends string | undefined> = Index extends string
  ? UndottedKey<Index>
  : Index;

/**
 * The output-name uniqueness guard for the aggregate/distinct family, applied
 * as a parameter intersection (the {@link UndottedGroupAliases} precedent).
 *
 * The `aggregate` (and `distinct`) stage rejects ANY two output fields sharing a
 * name — an accumulator alias equal to a group-key name, two accumulators with
 * the same alias, and two group keys with the same output name are all
 * INVALID_ARGUMENT (probed — aggregate-research §"OUTPUT NAMES MUST BE UNIQUE").
 * There is NO winner to pick, so the whole output-name SET (every group's output
 * name UNION every accumulator alias) must be pairwise DISTINCT. By the
 * ban-what-silently-succeeds rule (see `ExpressionBase.as`), each collision is a
 * COMPILE error rather than a resolved overlap.
 *
 * Maps over the guarded tuple `T` (the groups, or the accumulators); an element
 * whose output name occurs a SECOND time anywhere in the combined name list
 * `All` collapses to `never`, so the offending call is unassignable at the
 * parameter and does not type-check. `All` carries multiplicity (it is built
 * from the tuples, not a deduped union), so a duplicate is detected by removing
 * this element's single occurrence and asking whether the name still remains.
 *
 * Contrast `select` / `addFields` / `unnest`, whose output overlaps DO resolve
 * (last-wins / added-field-wins) — the backend accepts them there, so
 * {@link DropOverriddenSelections} and the merge operators stay correct for
 * those stages. Overlap resolution is stage-specific; only this family rejects.
 */
export type UniqueAggregateOutputs<T extends readonly unknown[], All extends readonly string[]> = {
  [I in keyof T]: AggregateOutputName<T[I]> extends infer Name extends string
    ? Name extends RemoveFirstName<Name, All>[number]
      ? never
      : T[I]
    : T[I];
};

/**
 * The combined output-name list of a groups/accumulators tuple, order and
 * MULTIPLICITY preserved (a tuple, not a deduped union) so
 * {@link UniqueAggregateOutputs} can tell one occurrence from two.
 */
export type AggregateOutputNames<T extends readonly unknown[]> = {
  [I in keyof T]: AggregateOutputName<T[I]>;
};

/**
 * The output name a group selection or accumulator contributes: an aliased
 * group or an accumulator by its `alias`, a bare {@link Field} by its `path`, a
 * bare key string by itself ({@link SelectionPath}). The one place the three
 * group forms and the accumulator alias collapse to a comparable name.
 */
type AggregateOutputName<S> = S extends { alias: infer A extends string } ? A : SelectionPath<S>;

/**
 * Drops the FIRST element of `Names` equal to `N`, leaving any later duplicates.
 * Removing exactly one occurrence turns "is this name duplicated" into "does the
 * name still remain afterwards" for {@link UniqueAggregateOutputs}.
 */
type RemoveFirstName<N extends string, Names extends readonly string[]> = Names extends readonly [
  infer H extends string,
  ...infer R extends readonly string[],
]
  ? [H] extends [N]
    ? [N] extends [H]
      ? R
      : [H, ...RemoveFirstName<N, R>]
    : [H, ...RemoveFirstName<N, R>]
  : [];

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

/**
 * The output path a selection contributes to: an alias's path, a bare `Field`'s
 * own path (a `Field` is its own alias), or a bare path string.
 */
type SelectionPath<S> =
  S extends ExpressionWithAlias<infer _T, infer P>
    ? P
    : S extends Field<infer _T, infer P>
      ? P
      : S extends string
        ? S
        : never;

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
 *
 * Accepts **aliased expressions only** — neither bare form of `select`'s
 * {@link Selection} (a path string, or a bare `Field`) is allowed here, and
 * that exclusion is deliberate: both name an EXISTING field, so re-adding it
 * under its own name is a schema no-op at best, and for a path through an
 * optional map it would silently mutate rows (the backend materializes the
 * missing intermediate layers as empty maps — verified live), so the schema
 * would lie. Write the intent explicitly with an alias instead. (The official
 * SDK does accept a bare `Field` here, since its `Field` is a `Selectable`; we
 * narrow it away for the reason above.)
 */
export type BuildAddFieldsSchema<
  Context extends Fields,
  Args extends readonly ExpressionWithAlias[],
> = MergeSchemas<BuildSelectionSchema<Context, Args>, Context>;

/**
 * Output schema of the `aggregate` stage: the group keys' schema, transformed
 * so no key can be absent ({@link AbsentMergesIntoNull}), with the accumulator
 * results joined on top.
 *
 * The groups' {@link BuildSelectionSchema} output (identical projection rules
 * to `distinct` — probed) is passed through {@link AbsentMergesIntoNull}
 * because null and absent group keys merge into one `null` group (probed), so
 * a group key reads back as nullable, never absent. The accumulator record is
 * then joined by {@link MergeSchemas}: accumulator aliases and group names are
 * guaranteed pairwise DISTINCT ({@link UniqueAggregateOutputs} rejects any
 * collision at the `Pipeline.aggregate` parameter), so the two records share no
 * key and the merge is a plain DISJOINT UNION — the first-argument-wins arm is
 * never reached. Empty groups yield an accumulators-only schema (the whole-input
 * group).
 */
export type AggregateSchema<
  Context extends Fields,
  Accs extends readonly AggregateWithAlias[],
  Groups extends readonly AggregateGroup<Context>[],
> = MergeSchemas<AccumulatorSchema<Accs>, GroupSchema<Context, Groups>>;

/**
 * The group-key half of the aggregate/distinct output schema: the groups'
 * {@link BuildSelectionSchema} projection with every `X & Optional` key
 * rewritten to `nullable(X)` ({@link AbsentMergesIntoNull} — null and absent
 * group keys merge into one `null` group, probed). Shared by
 * {@link AggregateSchema} (as its group half, under the accumulator record) and
 * {@link DistinctSchema} (as the whole schema — `distinct` is a grouped
 * aggregate with zero accumulators), so both stages compute group keys
 * identically.
 */
type GroupSchema<
  Context extends Fields,
  Groups extends readonly AggregateGroup<Context>[],
> = AbsentMergesIntoNull<BuildSelectionSchema<Context, Groups>>;

/**
 * Output schema of the `distinct` stage: the {@link GroupSchema} of its group
 * keys, and nothing else — `distinct` is semantically a grouped aggregate with
 * ZERO accumulators, so EVERY group rule carries over (probed): null and absent
 * keys merge into one `null` group (each `X & Optional` key reads back nullable,
 * never absent), a nested field groups only via an expression with a TOP-LEVEL
 * alias (the backend rejects dotted assignment targets —
 * `TOP_LEVEL_PROPERTY_PATH_ONLY`), and a MAP-typed key is compared as a value
 * (inner absences preserved — the rewrite is shallow). The rows are not source
 * documents, so the pipeline's `Id` becomes `undefined`.
 */
export type DistinctSchema<
  Context extends Fields,
  Groups extends readonly AggregateGroup<Context>[],
> = GroupSchema<Context, Groups>;

/**
 * Output schema of the `unnest` stage: the input context with the array's
 * ELEMENT overlaid under the selectable's output name — plus the element's
 * offset under `indexField` when one is requested.
 *
 * The overlay is `addFields`-shaped: the exact
 * `MergeSchemas<additions, Context>` composition of {@link BuildAddFieldsSchema}
 * (added-field-wins), which is why aliasing onto the SOURCE's own name replaces
 * the array with the element — what the backend does (probed). The source field
 * otherwise survives alongside the alias.
 *
 * The alias and the index descriptors are derived from the source array's
 * descriptor by DIFFERENT rules (they do not travel together — see
 * {@link UnnestAliasType} / {@link UnnestIndexType}):
 *
 * | source               | alias           | index               |
 * | -------------------- | --------------- | ------------------- |
 * | `array(E)`           | `E`             | `int64()`           |
 * | `nullable(array(E))` | `nullable(E)`   | `nullable(int64())` |
 * | `optional(array(E))` | `E & Optional`  | `nullable(int64())` |
 *
 * (An empty array emits NO row at all, so a row produced from a real array
 * always carries a real element and a real int64 index.)
 */
export type UnnestSchema<
  Context extends Fields,
  Sel extends UnnestSelectable<Context>,
  Index extends string | undefined,
> = MergeSchemas<UnnestOverlay<Context, Sel, Index>, Context>;

/**
 * A selectable of the `unnest` stage: a bare ARRAY-valued {@link Field} of the
 * context, or an aliased ARRAY-valued expression. Array-valued by construction
 * ({@link ArrayValued}), which is what makes the non-array no-op row of the
 * backend (an alias carrying the source VALUE — probed, contradicting the SDK's
 * doc comment) unreachable through this library.
 *
 * A bare `Field` is accepted for the same reason as in {@link Selection}: its
 * `path` IS its output name. A bare path STRING is deliberately NOT offered —
 * the SDK takes a `Selectable`, and the bare-`Field` form already covers it.
 *
 * The SOURCE path may be dotted (`field('m.k').as('e')` unnests a nested array
 * — probed); only the OUTPUT name is restricted to top level, which is enforced
 * one level up by {@link UndottedSelectionAlias} at the `Pipeline.unnest`
 * parameter, so a dotted bare `Field` and a dotted alias fail the same way.
 */
export type UnnestSelectable<Context extends Fields> =
  | Field<ArrayValued, MapFieldPath<Context>>
  | ExpressionWithAlias<ArrayValued>;

/**
 * The fields `unnest` overlays on its input context: the element at the
 * selectable's output name, merged with the index field's contribution (`{}`
 * when no index field was requested).
 *
 * The alias comes FIRST so it wins a name collision with the index field —
 * a merge order that is never actually exercised: the backend rejects an
 * `indexField` equal to the alias outright (INVALID_ARGUMENT, "Index field `e`
 * cannot be the same name as the alias `e`" — probed). Left unguarded at the
 * type level on purpose, per the rule stated on `ExpressionBase.as`: ban what
 * would silently succeed against the type model, leave what fails loudly to the
 * backend.
 */
type UnnestOverlay<
  Context extends Fields,
  Sel extends UnnestSelectable<Context>,
  Index extends string | undefined,
> = MergeSchemas<
  PathToSchema<SelectionPath<Sel>, UnnestAliasType<UnnestSourceType<Context, Sel>>>,
  UnnestIndexSchema<Index, UnnestIndexType<UnnestSourceType<Context, Sel>>>
>;

/**
 * The descriptor of the ARRAY `unnest` reads, as the ROW sees it — the
 * selectable's own descriptor with ancestor optionality moved onto it
 * ({@link WithConditionality}) when it reads a field path. Mirrors
 * {@link SelectionToSchema}'s dispatch arm for arm (a path-reading selection is
 * conditional, a computed expression always produces a value), minus the bare
 * string arm that {@link UnnestSelectable} does not offer.
 */
type UnnestSourceType<Context extends Fields, Sel> = Sel extends {
  expression: Field<infer T, infer P>;
  alias: string;
}
  ? WithConditionality<Context, P, T>
  : Sel extends ExpressionWithAlias<infer T, string>
    ? T
    : Sel extends Field<infer T, infer P>
      ? WithConditionality<Context, P, T>
      : never;

/**
 * The descriptor bound to the ALIAS, derived from the source array's
 * descriptor: the element type, carrying the source's null-ness but NOT
 * observing its absence as null.
 *
 * Both halves of that asymmetry are deliberate, and both are visible in the
 * composition: `PropagateNull` is fed `WithoutOptional<Source>` so the ABSENCE
 * arm of its condition cannot fire (a null source emits a no-op row whose alias
 * is `null`, but an ABSENT source emits a no-op row whose alias is likewise
 * ABSENT — probed), and {@link PreserveOptional} then carries that absence over
 * as the `Optional` marker instead. Contrast {@link UnnestIndexType}, which
 * takes the source unstripped and so nulls on BOTH.
 */
type UnnestAliasType<Source extends FieldType> = PreserveOptional<
  Source,
  PropagateNull<WithoutOptional<Source>, ArrayElementType<Source>>
>;

/**
 * The descriptor bound to the INDEX field: the element's int64 offset, nullable
 * when the source can be null OR absent.
 *
 * Plain {@link PropagateNull} — its condition (`'null'` tag OR the `Optional`
 * marker) is exactly the probed rule: the index field is ALWAYS PRESENT on an
 * emitted row and is `null` on every no-op row, including the absent-source row
 * where the alias itself is absent. So it is `int64()` only for a source that
 * is neither nullable nor optional, whose rows all come from a real array.
 */
type UnnestIndexType<Source extends FieldType> = PropagateNull<Source, Int64Type>;

/**
 * The index field's contribution to the overlay: its descriptor at its (always
 * top-level) name, or `{}` when no index field was requested.
 */
type UnnestIndexSchema<Index extends string | undefined, T extends FieldType> = Index extends string
  ? PathToSchema<Index, T>
  : {};

/**
 * Folds the accumulators into a flat `alias -> result descriptor` record.
 * Accumulator aliases are guaranteed pairwise DISTINCT
 * ({@link UniqueAggregateOutputs} rejects a duplicate alias at the
 * `Pipeline.aggregate` parameter), so {@link OverwriteMerge} only ever joins a
 * fresh key: the fold is a disjoint record build. Aliases are always top-level
 * names, so there is nothing to deep-merge, unlike the group schema.
 */
type AccumulatorSchema<Accs extends readonly AggregateWithAlias[]> = Accs extends readonly [
  infer H extends AggregateWithAlias,
  ...infer R extends readonly AggregateWithAlias[],
]
  ? OverwriteMerge<AccumulatorEntry<H>, AccumulatorSchema<R>>
  : {};

/** The single-entry schema an accumulator contributes: its alias mapped to its result descriptor. */
type AccumulatorEntry<A extends AggregateWithAlias> = { [K in A['alias']]: A['aggregate']['type'] };

/**
 * Shallow key-wise merge (`B`'s value wins a shared key; no deep map merge) —
 * the accumulator fold's combiner. Its operands are always disjoint here
 * (accumulator aliases are guaranteed distinct), so it acts as a flat union;
 * the `B`-wins arm exists only to keep the operator total.
 */
type OverwriteMerge<A, B> = {
  [K in keyof A | keyof B]: K extends keyof B ? B[K] : K extends keyof A ? A[K] : never;
};

/**
 * Rewrites every `X & Optional` field — at ANY map depth — to
 * `Normalize<[WithoutOptional<X>, NullType]>`: null and absent group keys
 * merge into one `null` group (probed), so a group key is never absent in the
 * result schema. SHALLOW by design: group outputs are always TOP-LEVEL keys
 * (the backend rejects dotted assignment targets in `aggregate` —
 * `TOP_LEVEL_PROPERTY_PATH_ONLY`, probed), and a MAP-typed group key keeps
 * its inner absences intact — the map is compared and projected AS A VALUE
 * (probed: `{ b: {} }` and `{ b: { c: 'v1' } }` form distinct groups; only
 * the wholly-absent map merges into the null group).
 */
export type AbsentMergesIntoNull<S extends Fields> = {
  [K in keyof S]: RewriteAbsentField<S[K]>;
  // The `infer R extends Fields` re-binding discharges the schema constraint
  // lazily: over an unresolved `S` the mapped type's value positions are not
  // PROVABLY `FieldType`, so without it the result is rejected wherever a
  // schema is required. Identity on every instantiation (`S extends Fields`
  // and `RewriteAbsentField` returns a `FieldType`), so the operator is a
  // `Fields` by construction and its callers need no re-binding of their own.
} extends infer R extends Fields
  ? R
  : never;

type RewriteAbsentField<T extends FieldType> = T extends Optional
  ? Normalize<[WithoutOptional<T>, NullType]>
  : T;

/**
 * Resolves one selection into the partial schema it contributes to the output.
 * Selections that read a source **field path** (bare paths, bare `Field`s, and
 * aliases whose expression is a `Field`) mark the projected leaf `Optional`
 * when the path crosses an optional ancestor ({@link WithConditionality});
 * computed expressions always produce a value and stay as-is.
 *
 * A bare `Field` folds exactly as `field(p).as(p)` would: output path = its
 * `path`, descriptor = its own `type`. The descriptor comes from the node, not
 * from a fresh `FieldTypeOfPath` lookup, so the bare and aliased `Field` forms
 * cannot drift apart — and `FieldProvider` resolves the node's `type` from the
 * very same schema, which is what makes a bare `Field` equal the bare string.
 */
type SelectionToSchema<Context extends Fields, S> = S extends {
  expression: Field<infer T, infer P>;
  alias: infer A extends string;
}
  ? PathToSchema<A, WithConditionality<Context, P, T>>
  : S extends ExpressionWithAlias<infer T, infer P>
    ? PathToSchema<P, T>
    : S extends Field<infer T, infer P>
      ? PathToSchema<P, WithConditionality<Context, P, T>>
      : S extends string
        ? S extends MapFieldPath<Context>
          ? PathToSchema<S, WithConditionality<Context, S, FieldTypeOfPath<Context, S>>>
          : {}
        : {};

/**
 * Marks the resolved leaf type `Optional` when its source path is conditional
 * ({@link IsConditionalPath}). The backend materializes the intermediate
 * output layers of a dotted selection and omits only the leaf, so the
 * projection moves ancestor optionality onto the leaf — see
 * `docs/pipeline-query-projection-research.md`.
 */
type WithConditionality<Context extends Fields, P extends string, T extends FieldType> =
  IsConditionalPath<Context, P> extends true ? T & Optional : T;

/**
 * Whether the value at `P` can be absent even though the path is well-typed:
 * true when any **ancestor** segment carries the `Optional` marker. The leaf's
 * own marker is not this type's concern — it already survives through
 * `FieldTypeOfPath`.
 */
type IsConditionalPath<
  Context extends Fields,
  P extends string,
> = P extends `${infer Head}.${infer Rest}`
  ? Head extends keyof Context
    ? Context[Head] extends Optional
      ? true
      : Context[Head] extends MapType<infer F>
        ? IsConditionalPath<F, Rest>
        : false
    : false
  : false;

/**
 * Builds a single-entry schema where dots in `Path` produce nested `MapType` layers.
 * `PathToSchema<"profile.age", DoubleType>` -> `{ profile: MapType<{ age: DoubleType }> }`.
 * No `'__name__'` special case: the reserved alias is rejected at construction
 * (`ExpressionBase.as`), and a **nested** `'__name__'` segment is an ordinary
 * map key on the backend (verified live).
 */
type PathToSchema<
  Path extends string,
  T extends FieldType,
> = Path extends `${infer Head}.${infer Rest}`
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
  // Re-bound to `Fields` for the same reason as {@link AbsentMergesIntoNull}:
  // over unresolved operands the mapped type's value positions are not
  // PROVABLY `FieldType`. Every operand in this file is a schema, so the
  // re-binding is an identity and the result is a `Fields` by construction.
} extends infer R extends Fields
  ? R
  : never;

// ---------------------------------------------------------------------------
// Runtime counterparts. Each helper is DECLARED AS the type-level operator of
// the same name applied to its own arguments, so the assertion inside it claims
// exactly one step and the COMPOSITION of the steps is checked by the compiler:
// a helper whose runtime result stops matching its twin's shape breaks the
// callers that feed it, instead of being absorbed by one assertion at the top.
// The `build*` functions are the entry points the `Pipeline` stages call.
// ---------------------------------------------------------------------------

/**
 * Runtime counterpart of {@link BuildSelectionSchema}: computed with the same
 * decomposition as the type — `foldSelections(schema, dropOverriddenSelections(args))`
 * IS `FoldSelections<Context, DropOverriddenSelections<Args>>`, which is why
 * this composition needs no assertion of its own. The result feeds the next
 * stage's field resolution and the executors' row decoding, so it must mirror
 * the type-level result exactly — the type tests in `selection.test.ts` plus
 * the pipeline spec pin both halves.
 */
export const buildSelectionSchema = <
  Context extends Fields,
  const Selections extends readonly Selection<Context>[],
>(
  schema: Context,
  selections: Selections,
): BuildSelectionSchema<Context, Selections> =>
  foldSelections(schema, dropOverriddenSelections(selections));

/**
 * Runtime counterpart of {@link BuildAddFieldsSchema}: the same
 * `MergeSchemas<BuildSelectionSchema<Context, Args>, Context>` composition
 * (the added fields' schema wins on overlap, deep-merging nested maps —
 * verified against the backend).
 */
export const buildAddFieldsSchema = <
  Context extends Fields,
  const Selections extends readonly ExpressionWithAlias[],
>(
  schema: Context,
  selections: Selections,
): BuildAddFieldsSchema<Context, Selections> =>
  mergeSchemas(foldSelections(schema, dropOverriddenSelections(selections)), schema);

/**
 * Runtime counterpart of {@link AggregateSchema}: computed with the same
 * decomposition as the type — `mergeSchemas(accumulatorSchema(...), groupSchema(...))`
 * IS `MergeSchemas<AccumulatorSchema<Accs>, GroupSchema<Context, Groups>>`, so
 * the composition itself carries no assertion. The result feeds the executors'
 * row decoding, so it must mirror the type exactly — the tests in
 * `selection.test.ts` pin both halves.
 */
export const buildAggregateSchema = <
  Context extends Fields,
  const Accs extends readonly AggregateWithAlias[],
  const Groups extends readonly AggregateGroup<Context>[] = readonly [],
>(
  schema: Context,
  accumulators: Accs,
  groups?: Groups,
): AggregateSchema<Context, Accs, Groups> => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bridges ONE step: an omitted `groups` argument means the empty group list and leaves `Groups` at its `readonly []` default, but the compiler does not tie a parameter's runtime default to a type parameter's default.
  const groupList = (groups ?? []) as Groups;
  return mergeSchemas(accumulatorSchema(accumulators), groupSchema(schema, groupList));
};

/**
 * Runtime counterpart of {@link DistinctSchema}: the group-key schema and
 * nothing else — `distinct` is a grouped aggregate with zero accumulators, so
 * this is just {@link groupSchema}, whose declared return type IS
 * {@link GroupSchema} — so no assertion is needed here at all. The result feeds
 * the executors' row decoding, so it must mirror the type exactly — the tests
 * in `selection.test.ts` pin both halves.
 */
export const buildDistinctSchema = <
  Context extends Fields,
  const Groups extends readonly AggregateGroup<Context>[],
>(
  schema: Context,
  groups: Groups,
): DistinctSchema<Context, Groups> => groupSchema(schema, groups);

/**
 * Runtime counterpart of {@link UnnestSchema}: the same
 * `MergeSchemas<UnnestOverlay<...>, Context>` composition (the overlay wins on
 * overlap — the `addFields` rule, which is what lets an alias onto the source's
 * own name replace the array with the element). The result feeds the executors'
 * row decoding, so it must mirror the type exactly — the tests in
 * `selection.test.ts` pin both halves.
 */
export const buildUnnestSchema = <
  Context extends Fields,
  const Sel extends UnnestSelectable<Context>,
  const Index extends string | undefined = undefined,
>(
  schema: Context,
  selectable: Sel,
  indexField: Index | undefined = undefined,
): UnnestSchema<Context, Sel, Index> => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bridges ONE step: an omitted `indexField` argument means "no index field" and leaves `Index` at its `undefined` default, but the compiler does not tie a parameter's absence to a type parameter's default.
  const index = indexField as Index;
  return mergeSchemas(unnestOverlay(schema, selectable, index), schema);
};

/**
 * Runtime counterpart of {@link UnnestOverlay}: the alias's single-entry schema
 * merged over the index field's contribution.
 *
 * The source descriptor is resolved ONCE and fed to both derivations, which is
 * where their asymmetry is visible side by side — `unnestAliasType` strips the
 * absence marker before propagating null and re-applies it, `unnestIndexType`
 * propagates from the same descriptor unstripped.
 *
 * Typed as `UnnestOverlay<...>` and computed from helpers that are each typed
 * as their own type-level twin, so the compiler — not a comment — checks that
 * the composition matches the type's decomposition; no assertion of its own.
 */
const unnestOverlay = <
  Context extends Fields,
  Sel extends UnnestSelectable<Context>,
  Index extends string | undefined,
>(
  schema: Context,
  selectable: Sel,
  indexField: Index,
): UnnestOverlay<Context, Sel, Index> => {
  const source = unnestSourceType(schema, selectable);
  return mergeSchemas(
    pathToSchema(selectionPath(selectable), unnestAliasType(source)),
    unnestIndexSchema(indexField, unnestIndexType(source)),
  );
};

/**
 * Runtime counterpart of {@link UnnestSourceType}, mirroring
 * {@link selectionToSchema}'s dispatch arm for arm (minus the bare string arm,
 * which {@link UnnestSelectable} does not offer).
 */
const unnestSourceType = <Context extends Fields, Sel extends UnnestSelectable<Context>>(
  schema: Context,
  selectable: Sel,
): UnnestSourceType<Context, Sel> => {
  // Widened to the union first: narrowing a generic `Sel` in place leaves it a
  // type parameter that `in` cannot discriminate.
  const node: UnnestSelectable<Fields> = selectable;
  const result = ((): FieldType => {
    if (!('alias' in node)) {
      // A bare `Field`: its own `type` is the source descriptor, conditional on
      // its path — the exact resolution the aliased `field(p).as(a)` arm runs.
      return withConditionality(schema, node.path, node.type);
    }
    const { expression } = node;
    switch (expression.kind) {
      case 'field':
        return withConditionality(schema, expression.path, expression.type);
      case 'constant':
      case 'functionExpression':
        return expression.type;
      default:
        return assertNever(expression);
    }
  })();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bridges ONE step: `UnnestSourceType` dispatches on the shape of `Sel` with a conditional type, the runtime on the shape of the VALUE; narrowing the value does not narrow `Sel`, so the arms cannot be matched up by the compiler.
  return result as UnnestSourceType<Context, Sel>;
};

/**
 * Runtime counterpart of {@link UnnestAliasType}, typed as that operator applied
 * to its input — the same `preserveOptional(source, propagateNullType(withoutOptional(source), ...))`
 * composition, so the absence/null asymmetry is checked step for step and needs
 * no assertion here.
 */
const unnestAliasType = <Source extends FieldType>(source: Source): UnnestAliasType<Source> =>
  preserveOptional(source, propagateNullType(withoutOptional(source), arrayElementType(source)));

/** Runtime counterpart of {@link UnnestIndexType}, typed as that operator applied to its input. */
const unnestIndexType = <Source extends FieldType>(source: Source): UnnestIndexType<Source> =>
  propagateNullType(source, int64());

/** Runtime counterpart of {@link UnnestIndexSchema}, typed as that operator applied to its inputs. */
const unnestIndexSchema = <Index extends string | undefined, T extends FieldType>(
  indexField: Index,
  type: T,
): UnnestIndexSchema<Index, T> => {
  const result = indexField === undefined ? {} : pathToSchema(indexField, type);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bridges ONE step: `UnnestIndexSchema` branches on `Index extends string`, a type-level test the runtime performs with an `undefined` check; the compiler does not relate the two.
  return result as UnnestIndexSchema<Index, T>;
};

/**
 * Runtime counterpart of {@link GroupSchema}, shared by `buildAggregateSchema`
 * and `buildDistinctSchema`: the groups' selection schema with each key passed
 * through `absentMergesIntoNull`. Group output names are guaranteed pairwise
 * distinct ({@link UniqueAggregateOutputs} at the `Pipeline` parameter) and are
 * top-level (dot-free), so `dropOverriddenSelections` never has a conflict to
 * resolve — it is present only to reuse `buildSelectionSchema`'s composition and
 * is an identity on this guaranteed-distinct group set.
 *
 * Typed as `GroupSchema<Context, Groups>` and computed from helpers that are
 * each typed as their own type-level twin, so the compiler — not a comment —
 * checks that the composition matches the type's decomposition.
 */
const groupSchema = <Context extends Fields, Groups extends readonly AggregateGroup<Context>[]>(
  schema: Context,
  groups: Groups,
): GroupSchema<Context, Groups> =>
  absentMergesIntoNull(foldSelections(schema, dropOverriddenSelections(groups)));

/**
 * Runtime counterpart of {@link AccumulatorSchema}: a flat `alias -> descriptor`
 * record built by iterating the accumulators. Aliases are guaranteed distinct
 * ({@link UniqueAggregateOutputs} at the `Pipeline.aggregate` parameter), so each
 * assignment writes a fresh key (mirrors the type's disjoint `OverwriteMerge`
 * fold).
 */
const accumulatorSchema = <const Accs extends readonly AggregateWithAlias[]>(
  accumulators: Accs,
): AccumulatorSchema<Accs> => {
  const result: Record<string, FieldType> = {};
  for (const { aggregate, alias } of accumulators) {
    result[alias] = aggregate.type;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bridges ONE step: `AccumulatorSchema` folds the TUPLE `Accs` with `OverwriteMerge`, which the compiler cannot match against the in-order loop that overwrites repeated aliases.
  return result as AccumulatorSchema<Accs>;
};

/** Runtime counterpart of {@link AbsentMergesIntoNull}, typed as that operator applied to its input. */
const absentMergesIntoNull = <S extends Fields>(schema: S): AbsentMergesIntoNull<S> => {
  const result = Object.fromEntries(
    Object.entries(schema).map(([k, v]) => [k, rewriteAbsentField(v)]),
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bridges ONE step: `AbsentMergesIntoNull` is a mapped type over `keyof S`, which the compiler cannot match against an `Object.entries`/`fromEntries` rebuild.
  return result as AbsentMergesIntoNull<S>;
};

/** Runtime counterpart of {@link RewriteAbsentField}, typed as that operator applied to its input. */
const rewriteAbsentField = <T extends FieldType>(
  t: T & { optional?: boolean },
): RewriteAbsentField<T> => {
  const result = t.optional === true ? nullable(withoutOptional(t)) : t;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bridges ONE step: `RewriteAbsentField` branches on `T extends Optional`, a type-level test the runtime performs by reading the `optional` marker; the compiler does not relate the two.
  return result as RewriteAbsentField<T>;
};

/**
 * Runtime counterpart of {@link DropOverriddenSelections}: keeps each selection
 * only if no later selection conflicts with it (last-wins).
 */
export const dropOverriddenSelections = <const Args extends readonly SelectionNode[]>(
  selections: Args,
): DropOverriddenSelections<Args> => {
  const result = selections.filter(
    (s, i) =>
      !selections
        .slice(i + 1)
        .some((later) => pathsConflict(selectionPath(s), selectionPath(later))),
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bridges ONE step: `DropOverriddenSelections` builds a FILTERED TUPLE by recursing on `Args`, while the runtime filters an array; the compiler cannot see that the kept elements are exactly the tuple's members.
  return result as DropOverriddenSelections<Args>;
};

/**
 * Runtime counterpart of {@link FoldSelections}: the same
 * `MergeSchemas<SelectionToSchema<First>, FoldSelections<Rest>>` recursion.
 */
const foldSelections = <Context extends Fields, Args extends readonly SelectionNode[]>(
  schema: Context,
  selections: Args,
): FoldSelections<Context, Args> => {
  const [first, ...rest] = selections;
  const result =
    first === undefined
      ? {}
      : mergeSchemas(selectionToSchema(schema, first), foldSelections(schema, rest));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bridges ONE step: `FoldSelections` recurses by destructuring the TUPLE `Args`, while the runtime destructures an array value; the compiler cannot see that `rest` is the type-level `Rest`.
  return result as FoldSelections<Context, Args>;
};

/**
 * Runtime counterpart of {@link SelectionToSchema}. Where the type resolves a
 * path's field type via `FieldTypeOfPath`, the runtime uses `fieldTypeOfPath`
 * (which throws for unknown paths — the type-level `{}` fallback for non-path
 * strings is unreachable through the typed API, so a throw is the defensive
 * equivalent).
 */
const selectionToSchema = <Context extends Fields, S extends SelectionNode>(
  schema: Context,
  s: S,
): SelectionToSchema<Context, S> => {
  // Widened to the union first: narrowing a generic `S` in place leaves it an
  // object-or-string type parameter that `typeof` / `in` cannot discriminate.
  const node: SelectionNode = s;
  const result = ((): Fields => {
    if (typeof node === 'string') {
      return pathToSchema(
        node,
        withConditionality(schema, node, fieldTypeOfPath<Fields, string>(schema, node)),
      );
    }
    if (!('alias' in node)) {
      // A bare `Field`: its `path` is its output name, and its own `type` is the
      // descriptor — the exact fold the aliased `field(p).as(p)` arm below runs.
      return pathToSchema(node.path, withConditionality(schema, node.path, node.type));
    }
    const { expression, alias } = node;
    switch (expression.kind) {
      case 'field':
        return pathToSchema(alias, withConditionality(schema, expression.path, expression.type));
      case 'constant':
      case 'functionExpression':
        return pathToSchema(alias, expression.type);
      default:
        return assertNever(expression);
    }
  })();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bridges ONE step: `SelectionToSchema` dispatches on the shape of `S` with a conditional type, the runtime on the shape of the VALUE; narrowing the value does not narrow `S`, so the arms cannot be matched up by the compiler.
  return result as SelectionToSchema<Context, S>;
};

/** Runtime counterpart of {@link WithConditionality}, typed as that operator applied to its inputs. */
const withConditionality = <Context extends Fields, P extends string, T extends FieldType>(
  schema: Context,
  path: P,
  type: T,
): WithConditionality<Context, P, T> => {
  const result = isConditionalPath(schema, path) ? optional(type) : type;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bridges ONE step: `WithConditionality` branches on the type-level `IsConditionalPath`, which the runtime decides by walking the schema value; the compiler cannot connect the boolean to the conditional type.
  return result as WithConditionality<Context, P, T>;
};

/** Runtime counterpart of {@link IsConditionalPath}. */
const isConditionalPath = (schema: Fields, path: string): boolean => {
  const dot = path.indexOf('.');
  if (dot < 0) {
    return false;
  }
  const head = schema[path.slice(0, dot)];
  if (head === undefined) {
    return false;
  }
  // Read the marker before `isMapType` narrows the descriptor to `AnyMapType`
  // (narrowing drops the `optional?` part of the `MapFields` intersection).
  if (head.optional === true) {
    return true;
  }
  return isMapType(head) ? isConditionalPath(head.fields, path.slice(dot + 1)) : false;
};

/** Runtime counterpart of {@link SelectionPath}, typed as that operator applied to its input. */
const selectionPath = <S extends SelectionNode>(s: S): SelectionPath<S> => {
  // Widened to the union first: narrowing a generic `S` in place leaves it an
  // object-or-string type parameter that `in` rejects.
  const node: SelectionNode = s;
  const result = typeof node === 'string' ? node : 'alias' in node ? node.alias : node.path;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bridges ONE step: narrowing the VALUE `s` does not narrow the type parameter `S`, so the compiler cannot see that each branch produces the corresponding arm of `SelectionPath<S>`.
  return result as SelectionPath<S>;
};

/** Runtime counterpart of {@link PathsConflict}. */
const pathsConflict = (a: string, b: string): boolean =>
  a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);

/** Runtime counterpart of {@link PathToSchema}, typed as that operator applied to its inputs. */
const pathToSchema = <Path extends string, T extends FieldType>(
  path: Path,
  type: T,
): PathToSchema<Path, T> => {
  const dot = path.indexOf('.');
  const result =
    dot < 0
      ? { [path]: type }
      : { [path.slice(0, dot)]: map(pathToSchema(path.slice(dot + 1), type)) };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bridges ONE step: `PathToSchema` splits `Path` with a template-literal match while the runtime splits with `indexOf`, and a computed key built from a generic `Path` is not seen to inhabit the resulting mapped type.
  return result as PathToSchema<Path, T>;
};

/**
 * Runtime counterpart of {@link MergeSchemas} (`a` wins on non-map conflicts),
 * typed as that operator applied to its inputs.
 */
const mergeSchemas = <A extends Fields, B extends Fields>(a: A, b: B): MergeSchemas<A, B> => {
  const result: Record<string, FieldType> = { ...b, ...a };
  for (const key of Object.keys(a)) {
    const va = a[key];
    const vb = b[key];
    if (va !== undefined && vb !== undefined && isMapType(va) && isMapType(vb)) {
      result[key] = map(mergeSchemas(va.fields, vb.fields));
    }
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bridges ONE step: `MergeSchemas` is a mapped type over `keyof A | keyof B` whose per-key branch the compiler cannot connect to the spread-and-patch loop below it.
  return result as MergeSchemas<A, B>;
};
