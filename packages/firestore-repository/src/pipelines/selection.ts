import {
  type DocumentSchema,
  type FieldType,
  type FieldTypeOfPath,
  fieldTypeOfPath,
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
  type ExpressionWithAlias,
  type Field,
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
  [I in keyof G]: G[I] extends { alias: infer A extends string }
    ? A extends `${string}.${string}`
      ? never
      : G[I]
    : G[I] extends Field<FieldType, infer P>
      ? P extends `${string}.${string}`
        ? never
        : G[I]
      : G[I];
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
 * results overlaid on top.
 *
 * The groups' {@link BuildSelectionSchema} output (identical projection rules
 * to `distinct` — probed) is passed through {@link AbsentMergesIntoNull}
 * because null and absent group keys merge into one `null` group (probed), so
 * a group key reads back as nullable, never absent. The accumulator record is
 * then merged ON TOP: an accumulator alias colliding with a group name **wins**
 * (the accumulator is the more specific intent, and `MergeSchemas`'s
 * first-argument-wins rule expresses it). Empty groups yield an
 * accumulators-only schema (the whole-input group).
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
 * Folds the accumulators into a flat `alias -> result descriptor` record. A
 * later accumulator with a repeated alias wins (plain overwrite — accumulator
 * aliases are always top-level names, so there is nothing to deep-merge,
 * unlike the group schema).
 */
type AccumulatorSchema<Accs extends readonly AggregateWithAlias[]> = Accs extends readonly [
  infer H extends AggregateWithAlias,
  ...infer R extends readonly AggregateWithAlias[],
]
  ? OverwriteMerge<AccumulatorEntry<H>, AccumulatorSchema<R>>
  : {};

/** The single-entry schema an accumulator contributes: its alias mapped to its result descriptor. */
type AccumulatorEntry<A extends AggregateWithAlias> = { [K in A['alias']]: A['aggregate']['type'] };

/** Shallow overwrite merge (`B` wins per key; no deep map merge) — the accumulator fold's combiner. */
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
 * Runtime counterpart of {@link GroupSchema}, shared by `buildAggregateSchema`
 * and `buildDistinctSchema`: the groups' selection schema (last-wins resolved,
 * as `buildSelectionSchema` does) with each key passed through
 * `absentMergesIntoNull`.
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
 * record built by iterating in order, so a repeated alias's later entry wins
 * (mirrors the type's `OverwriteMerge` fold).
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
      case 'functionCall':
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
