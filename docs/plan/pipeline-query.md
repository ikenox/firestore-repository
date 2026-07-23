# Pipeline Query — implementation plan

Working checklist for the Firestore Pipeline Query support. Detailed design is
intentionally out of scope here; this doc is for tracking what needs to be in
place and the status of each piece.

## Branching / merge strategy

Pipeline-query work does **not** merge directly to `main`. It is staged on the
long-lived **`pipeline`** branch:

- `pipeline` is the integration base for this feature.
- Each piece of work is developed on a feature branch **checked out from
  `pipeline`**, then merged **back into `pipeline`**.
- Once the feature is complete (and stable enough), `pipeline` is merged into
  `main` in one shot.

So `pipeline` can carry WIP / unstable code (the `Pipeline` class is marked as
such); only the final `pipeline` → `main` merge needs to be release-ready.

Related plans:

- [`pipeline-query-expressions.md`](./pipeline-query-expressions.md) — the
  expression-function restoration plan (class tree, inventory, rollout slices).

Related research / decisions:

- [`../pipeline-query-identity-research.md`](../pipeline-query-identity-research.md) — which stages preserve `id` / `ref` / `createTime` / `updateTime`.
- [`../pipeline-query-ordering-research.md`](../pipeline-query-ordering-research.md) — `sort` keeps rows missing the field (unlike core `orderBy`); `null` < absent < values.
- [`../pipeline-query-null-semantics-research.md`](../pipeline-query-null-semantics-research.md) — absent merges into `null` inside expressions; logical operators are Kleene three-valued; comparisons are total.
- [`../pipeline-query-projection-research.md`](../pipeline-query-projection-research.md) — `select` / `add_fields` output shaping (dotted-name materialization, conflict rejection vs the library's last-wins, add_fields merge rules).

## Current status (snapshot — read this first)

**Stages that run end-to-end today** (each verified live against
`ikenox-sunrise` / `enterprise-native-playground` through the google-cloud
adapter, and wired identically in the firebase adapter):

| stage                                    | schema effect                            | identity   |
| ---------------------------------------- | ---------------------------------------- | ---------- |
| `collection` / `collectionGroup` (input) | the collection's schema                  | preserved  |
| `where`                                  | unchanged                                | preserved  |
| `sort`                                   | unchanged                                | preserved  |
| `limit` / `offset`                       | unchanged                                | preserved  |
| `addFields`                              | context + added fields                   | preserved  |
| `removeFields`                           | context − removed paths                  | preserved  |
| `unnest`                                 | context + alias/index (addFields-shaped) | preserved† |
| `select`                                 | only the selections                      | **broken** |
| `aggregate`                              | accumulators over group keys             | **broken** |
| `distinct`                               | the group keys                           | **broken** |

† `unnest` preserves identity but ids are no longer unique across rows — an
n-element array yields n rows carrying the SAME source id.

"Identity broken" means the rows are no longer source documents, so the
pipeline's second type parameter becomes `undefined` and the results carry no
`id` — see "Identity ratchet" below.

**Still stubs** (`unimplemented()`, and the executors throw on them):
`replaceWith` (`fullReplaceWith` / `mergeWith`), `union`, `findNearest`, `let`,
`search`, `sample`; the `database()` / `documents()` / `literals()` input
sources; and the DML output stages (`update` / `delete`).

**How the runtime AST works:**

- Every implemented method builds a stage node linked to its parent
  (`{ kind, ...payload }` — see `stage.ts`), and an executor walks the `parent`
  chain to replay them into `db.pipeline()...`.
- The `parent` link is typed as `PipelineNode` (a methods-free structural view
  of `Pipeline`) so `Pipeline<Schema, Id>` — which is invariant in `Schema` —
  is assignable without a cast.
- `Expression` is a discriminated union (`field` / `constant` / `functionCall`).
  Field providers resolve each path's real runtime descriptor via
  `fieldTypeOfPath(schema, path)` in `schema.ts`.
- Stage payloads carry ALREADY conflict-resolved selections (last-wins applied
  by the `Pipeline` method), so an executor translates them 1:1.
- Each type-level schema operator has a runtime twin **declared as that
  operator applied to its own arguments**, so the compiler checks that the
  steps compose — see `selection.ts` and the guideline's §Type-level / runtime
  mirroring.

**Executors** (`packages/{firebase-js-sdk,google-cloud-firestore}/src/pipeline.ts`):
`executor(db)` walks the stage chain, translates each stage to its SDK call,
runs it, and converts each result via the per-adapter `fromFirestore.docRef` /
`decode` (exported through `buildFirestoreUtilities`).

**Running the pipeline spec tests** (Enterprise-only; the emulator can't run
pipelines):

```sh
cd packages/google-cloud-firestore   # (or firebase-js-sdk)
FIRESTORE_REPOSITORY_INTEGRATION_TEST_PROJECT=ikenox-sunrise \
FIRESTORE_REPOSITORY_INTEGRATION_TEST_DB=enterprise-native-playground \
pnpm exec vitest run -t 'pipeline specification'
```

The firebase (client) adapter's pipeline suite additionally requires
`FIRESTORE_REPOSITORY_INTEGRATION_TEST_CLIENT_API_KEY` (a real Firebase API
key): the client SDK cannot reach a non-emulator DB without one (and is
subject to security rules), unlike the admin SDK which authenticates via ADC
and bypasses rules. Without the extra var the firebase pipeline suite is
skipped, so a root-level `pnpm test` with only the two shared vars runs the
admin adapter live and skips the client adapter instead of failing.

Without those two env vars the pipeline `describe` is `skipIf`-skipped. See the
test-infra note under "Per-SDK adapters" for why the admin SDK can target the
real backend while the repository tests still use the emulator in the same run.

**Type assertions** (policy in `docs/coding-guideline.md`): the `decode` class
(runtime value → schema-derived type) — `fieldTypeOfPath` and each executor's
result map — plus the step-local bridges in `selection.ts`, where each runtime
twin asserts exactly ONE step of its type-level operator and the composition is
compiler-checked.

**Repo state:** `pnpm check` clean (lint 0, fmt clean); the full suite including
the live Enterprise DB passes. Adapter repository (non-pipeline) tests need the
emulator. Ad-hoc probe scripts live in `./.ikenox/` (gitignored).

## Conventions

Status markers:

- `[ ]` not started
- `[~]` in progress
- `[x]` done
- `[-]` decided to skip / out of scope (with reason)

## Done so far

- [x] `firestore-repository` package: `src/pipelines/` layout (`stage.ts`,
      `expression.ts`, `selection.ts`, `pipeline.ts`, `index.ts`).
- [x] `Pipeline<Context>` skeleton with `where` / `select` / `addFields` /
      `removeFields` / `aggregate` / `distinct` method stubs.
- [x] `Selection` / `BuildSelection` / `PathToSchema` / `MergeSchemas` —
      nested schema synthesis for `select`, with type tests.
- [x] `PickPaths` / `OmitPaths` in `schema.ts` with type tests.
- [x] `Expression<T>` / `Field<T, Path>` / `Constant<T>` / `FunctionCall<T>`
      AST. Previously had ~85 function factories covering all SDK expression
      categories + type tests — **these were trimmed** (with `expression.test.ts`)
      to the AST core plus `field` / `constant` / `equal` pending a rework. The
      old factories + their type tests are recoverable from git history
      (before the `pipeline-query` branch trim) if/when re-added.
- [x] Comparison operators with overload-based group compatibility
      (Int64↔Double, union widening, cross-group rejection) + type tests.
- [x] String / numeric / map / array / regex / timestamp / type-check /
      control-flow / reference factories, with type tests for return types
      and negative cases.
- [x] String-literal auto-wrap on map keys, regex / string predicate
      patterns, replace / split / join args (mirrors the official SDK).
- [x] `TimeUnit` / `TimeGranularity` / `FieldTypeName` literal narrowing
      for `timestampAdd` / `timestampSubtract` / `timestampTruncate` /
      `isType`.
- [x] Runtime AST building for `input` (collection source) + `sort`; `parent`
      chain via `PipelineNode`; executors in both adapter packages.
- [x] `field(type, path)` factory + `kind: 'field'` (Expression is a
      discriminated union); runtime `fieldTypeOfPath(schema, path)` resolver
      with exhaustive tests (`schema.field-type-of-path.test.ts`).
- [x] `const` type params on `select` / `addFields` / `distinct`.
- [x] `execute` modelled as `PipelineQueryExecutor.execute` (adapters implement
      it); the core `Pipeline` only builds the AST.

## Identity ratchet (second type parameter on `Pipeline`)

Decided against the two-class inheritance split in favor of a single
`Pipeline<Context, Id>` where `Id extends DocRef<Collection> | undefined`
carries read-identity (see `../pipeline-query-identity-research.md`). The
ratchet is structural: preserving stages thread `Id`, breaking stages reset to
`undefined`.

- [x] Add `Id extends PipelineRowIdentity` (`= DocRef<Collection> | undefined`)
      as the second type parameter of `Pipeline<Context, Id>`.
- [x] Identity-preserving methods (`where`, `sort`, `limit`, `offset`,
      `addFields`, `removeFields`, `unnest`) thread `Id` through unchanged.
- [x] Identity-breaking methods (`select`, `distinct`, `aggregate`,
      `fullReplaceWith`, `mergeWith`) return `Id = undefined`.
- [x] **`select` always drops identity — made honest by forbidding `__name__`
      (option A).** `select` is actually only conditionally identity-breaking: it
      keeps `id`/`ref` iff `field("__name__")` is projected un-aliased (`"__name__"`
      or `.as("__name__")`) — see research doc "select and the reserved metadata
      fields". Rather than model that (which would make `Id` depend on the
      selection contents), `select` returns `Id = undefined` unconditionally **and**
      `Selection` excludes `"__name__"` (uses `MapFieldPath`, not the doc-level
      `DocFieldPath`), so the identity-preserving projection is simply not
      expressible — the `undefined` never lies. `removeFields` likewise takes
      `MapFieldPath` (the key is not a removable data field). Identity-preserving
      reshaping goes through `addFields`/`removeFields`; `"__name__"` stays usable
      in `where`/`sort` (via `FieldProvider`, not `Selection`). Verified in both
      tsc and oxlint that `select(() => ["__name__"])` / `removeFields("__name__")`
      are type errors; covered by a `pipeline.test.ts` test using `@ts-expect-error`.
      See the JSDoc on `Pipeline.select` and `Selection`.
  - **Residual limitation:** for a **broad `DocumentSchema`** pipeline (the
    `database()` / `documents()` / `literals()` sources, whose `Schema` is the
    unconstrained `DocumentSchema`), `MapFieldPath<DocumentSchema>` collapses to
    `string`, which includes `"__name__"` — TypeScript cannot subtract a literal
    from `string`. So `select(() => ["__name__"])` is **not** rejected there.
    `literals()` is `Id = undefined` anyway (no lie), but `database()` /
    `documents()` are `Id = DocRef<Collection>`, so the type could still lie for
    those. Not fixable at the type level; the real guard belongs at runtime
    (reject / handle a `__name__` projection during `execute()` serialization).
- [ ] **(Deferred) Model `select` conditional identity + `createTime` /
      `updateTime`.** The full behavior (probed): selecting `__name__` /
      `__create_time__` / `__update_time__` un-aliased re-attaches `id`/`ref` /
      `createTime` / `updateTime` respectively. Doing this properly means
      generalizing the second type parameter from `Id` (`DocRef | undefined`) to a
      row-metadata record `{ ref; createTime; updateTime }`, threading it through
      every source/stage, and adding `createTime`/`updateTime` (with a timestamp
      value type — the repo's `Doc<T>` has none today) to `PipelineResult`. Same
      mechanism for all three (`SelectionKeepsPath<Sel, Path>` — a helper that was
      prototyped and removed). Wanted eventually; skipped now to avoid the
      complexity. If revisited, also consider an explicit opt-in
      (`select(..., { keepName: true })`) instead of type-level parsing of the
      selection list.
- [x] Source factories set the initial `Id`: `collection` /
      `collectionGroup` → `DocRef<T>` (collectionGroup assumes
      collection names are unique DB-wide); `database` / `documents` →
      `DocRef<Collection>`; `literals(...)` → `undefined`.
- [~] `execute(pipeline): Promise<PipelineResult<Schema, Id>[]>` — a
  **standalone function** (not a `Pipeline` method; mirrors
  `@firebase/firestore/pipelines`'s `execute(pipeline)`), stubbed; runtime
  deferred (see "`Pipeline` runtime / serialization" below).
- [ ] Type-level tests covering the ratchet across each method (the
      `pipeline.test.ts` `wip` block asserts the `Id` part but still fails
      typecheck on the unrelated `select` callback-vs-string mismatch).

## `PipelineResult` types

- [x] `PipelineResult<Context, Id>` = `{ data }` intersected with
      `Id extends undefined ? unknown : { readonly id: Id }`, so `id` is
      present only when identified and mirrors `Doc<T>`'s `id: DocRef<T>`.
- [x] Standalone `execute(pipeline): Promise<PipelineResult<Schema, Id>[]>`
      signature in place (runtime deferred).
- [ ] Add `createTime` / `updateTime` if/when needed (the repository's
      `Doc<T>` currently collapses identity to `id: DocRef<T>` only).
- [ ] Confirm shape compatibility with existing `Doc<C>` so `Mapper` reuse
      is straightforward (see "Mapper reuse" below) — identified results are
      already structurally `Doc<T>`.
- [ ] **Reserved metadata fields (`__name__` / `__create_time__` /
      `__update_time__`) need first-class handling.** They are the bridge
      between pipeline `select` and result metadata (probed; see research doc
      "select and the reserved metadata fields"):
  - `__name__` un-aliased ↔ `id` / `ref` (`DocRef`); `__create_time__` ↔
    `createTime`; `__update_time__` ↔ `updateTime`.
  - When **aliased** to another name, the value instead lands in `data` (a path
    string for `__name__`, a `Timestamp` for the time fields) — so they double
    as ordinary selectable expressions.
  - Decisions still open: whether to expose them as selectable paths at all,
    how to type the un-aliased→metadata vs aliased→data split, and whether to
    map them onto the result type's identity (`__name__` only, for now — see
    the skipped `select` conditional-identity item above) or also onto
    `createTime` / `updateTime` once those are modeled.
  - Note: these time fields are **pipeline-only**; the Core query API cannot
    `where`/`orderBy` on create/update time (official docs — only `__name__`,
    via `documentId()`, is queryable there).

## Stages

Existing stubs need real schema/Context transitions and runtime construction.

Input stages (the `input` stage now carries an `InputSource` payload — see
`stage.ts` — and the executors reconstruct it):

- [x] `collection` — builds `{ kind: 'collection', collection, parent }`;
      covers root collections and specific subcollection instances (the trailing
      `parent` doc-ids argument is required iff the definition is a subcollection).
- [x] `collectionGroup(id)` — builds `{ kind: 'collectionGroup', ... }`;
      executors run it via `db.pipeline().collectionGroup(name)`.
- [ ] `database()` / `documents([...refs])` — source payloads are stubbed
      (`{ kind: 'database' | 'documents' }`, no data); executor throws.
- [ ] `literals([...])` — stubbed (`{ kind: 'literals' }`); executor throws.

Transformation stages already stubbed:

- [x] `where(condition)` — stage carries the `Expression<BoolType>` condition,
      executors translate via `sdk.where(expr.asBoolean())` (a type-tag wrap, no
      wire change), identity preserved. Verified live incl. chained-where
      conjunction (AND) and the truthy-only row-drop semantics (missing operand
      fields drop the row silently).
- [x] `select(...)` — runtime schema fold (`buildSelectionSchema`, the runtime
      mirror of `BuildSelectionSchema`), stage AST carries conflict-resolved
      selections, executors translate to `sdk.select(...)`, rows decode with
      the pipeline's leaf schema. Verified live (nested dotted selects come
      back **nested**, matching `PathToSchema`; last-wins matches the type
      tests; `.as()` field + computed `equal` expressions work).
- [x] `addFields(...)` — runtime schema merge (`buildAddFieldsSchema`, the
      runtime mirror of `BuildAddFieldsSchema`), stage carries conflict-resolved
      selections, executors translate to `sdk.addFields(...)` (bare paths become
      `field(p).as(p)`), identity preserved. Backend semantics probed: added
      fields win on overlap, dotted aliases deep-merge into existing maps, a
      scalar added under a map's name replaces the map. Verified live.
- [x] `removeFields(...)` — runtime schema shrink (`omitPaths`, the runtime
      mirror of `OmitPaths`, incl. the Optional marker and the empty-map cascade),
      stage carries the field paths, executors translate to `sdk.removeFields(...)`,
      identity preserved (`Id` threads through). Verified live.
- [x] `distinct(...)` — a grouped aggregate with ZERO accumulators, sharing the
      group machinery (probed: every group rule carries over —
      TOP_LEVEL_PROPERTY_PATH_ONLY, null/absent merge, shallow map rewrite,
      empty input → zero rows). `DistinctSchema` = the shared `GroupSchema`
      operator; nonempty `AggregateGroup` tuple + `UndottedGroupAliases`;
      identity break. Both executors via `sdk.distinct({ groups })`. Verified live.
- [x] `limit(N)` / `offset(N)` — stages carry the count, executors translate
      to `sdk.limit/offset`, schema unchanged, identity preserved. Verified live
      incl. offset+limit paging and an over-sized limit.
- [x] `unnest(...)` — done (2026-07; semantics in
      `../pipeline-query-unnest-research.md`). The
      `unnest((field) => ({ selectable, indexField? }))` stage emits one row per
      array element, augmenting the row with
      the element under the selectable's output name (and its int64 offset under
      `indexField`). Identity is PRESERVED (`Id` threads through) — but ids are
      no longer unique across rows: an n-element array yields n rows carrying the
      SAME source id (probed, and pinned by a live same-id test). `selectable`
      takes the two selection forms (a bare array-valued `Field`, or an aliased
      array-valued expression) — array-valued by construction (`ArrayValued` /
      `ArrayElementType`), which makes the non-array no-op cell unreachable
      through the library. Output names are TOP-LEVEL only: a dotted alias AND a
      dotted `indexField` are both rejected (`UndottedSelectionAlias` /
      `UndottedIndexField` at the `Pipeline.unnest` parameter — probed
      INVALID_ARGUMENT), while the SOURCE path may be dotted. Schema effect is
      `addFields`-shaped (`UnnestSchema` = `MergeSchemas<overlay, Context>`,
      added-field-wins — so aliasing onto the source's own name replaces the
      array with the element; the source field otherwise survives). The alias
      and index descriptors are derived from the source array by DIFFERENT rules
      (they do not travel together — probed): `array(E)` → alias `E`, index
      `int64()`; `nullable(array(E))` → `nullable(E)` / `nullable(int64())`;
      `optional(array(E))` → `E & Optional` / `nullable(int64())`. Absence
      reaches the ALIAS only (an absent source emits a no-op row whose alias is
      itself absent — `PreserveOptional`), while the index picks up null from
      BOTH the null and absent cases (`PropagateNull`). Both executors via
      `sdk.unnest({ selectable, indexField })`. Verified live (google-cloud) —
      the spec reproduces every probed cell incl. empty-array (0 rows),
      null-element, and the index-null-on-absent-alias asymmetry.
- [ ] `replaceWith(...)` — Context replacement + identity break.
- [ ] `union(other)` — combine sources; identity break (conservative).
- [ ] `findNearest(...)` — vector search; behavior TBD.
- [ ] `let(...)` — variable binding for sub-pipelines.
- [ ] `search(...)` — full-text search; behavior TBD.
- [ ] `sample(...)` — sampling; identity preserve presumably.

Output stages (Pipeline DML):

- [ ] `update(...)` — write DML through pipeline.
- [ ] `delete()` — delete matching docs.

Deferred to a later iteration (still tracked here, not currently in scope):

- [x] `sort(...)` — **implemented end-to-end** (identity- and schema-preserving).
      `Pipeline.sort` builds `{ kind: 'sort', orderings }`; both executors
      translate to `field(path).ascending()/.descending()`. Only **field**
      orderings are supported (a computed-expression ordering throws in the
      executor). Verified live. See the spec `sort` tests.
- [x] `aggregate(...)` — done (2026-07; semantics in
      `../pipeline-query-aggregate-research.md`): `AggregateFunction` (SDK
      name; payload-union like `FunctionCall`, NOT an `Expression` member so
      misplacement is a type error) with all 12 factories (`arraySum` was an
      expression, not an accumulator — dropped from this list); probed
      return descriptors (count family plain int64; `sum`
      nullable+NumericResult; `average` nullable double;
      `minimum`/`maximum`/`first`/`last` `NullableStripped`; `arrayAgg*`
      element drops Optional, keeps the null tag). The
      `aggregate((field) => ({ accumulators, groups? }))` stage synthesizes
      `AggregateSchema` = groups' BuildSelection output through
      `AbsentMergesIntoNull` (null and absent group keys merge — probed) +
      accumulator overlay (accumulator wins on collision), identity breaks
      (`Id = undefined`). Executors: one `aggregateTranslators` mapped table
      per adapter; groups translate like select selections. Live catalog
      pins the probe matrix incl. empty-input and null/absent-merge cases.
- [ ] `ascending(...)` / `descending(...)` — ordering factories used by
      `sort` (and by cursor lowering in `__PRIVATE_toPipeline`).
- [ ] Type-level tests for `Ordering` / `AggregateFunction` along the lines
      of the existing `expression.test.ts` style.
- [~] `ordering.ts` started: `Ordering` type + `asc` / `desc` factories;
  `sort` now takes `(field) => Ordering[]`. Follow-ups:
  - Decide factory naming (`asc` / `desc` vs the official
    `ascending` / `descending`).
  - `asc` / `desc` currently accept only `Expression`. The official SDK also
    allows a bare field-name string, but we will most likely **not** support
    that: restricting a bare string to the Context's field paths would force
    `Ordering` (and `asc` / `desc`) to be parameterized by `Context`, whereas
    typed field access already goes through the `field(path)` provider in the
    `sort` callback (`sort((field) => [asc(field('name'))])`). Leaning toward
    keeping `Ordering` Context-free and not adding the string overload; revisit
    only if a concrete need appears.
  - Add the `Ordering` / `sort` type tests noted above.
  - Settle whether `Ordering` is imported as a value or `import type` in
    `pipeline.ts` (it is currently a value import of a type).

## Reference values: segment-path unification

- [x] **Done (2026-07).** Reference VALUES are uniformly `RefPath<T>` segment
      paths (`['Authors', <id>]`, `['Authors', <id>, 'Posts', <id>]`) — literal
      collection-name positions when the collection is known, `string[]` for the
      `'unknown'` flavor, so known/unknown is purely a gradient of tuple
      precision. The ids-only ADDRESS (`DocRef<T>`) survives only in the
      repository interface (`get`/`set`/`Doc.id`), with `refPath()` /
      `toDocRef()` (`path.ts`) converting at that one boundary.
  - `Collection` captures `name` as a literal (`const Name` on the
    factories; `parent` already was).
  - Both codecs: decode is a single arm (`ref.path.split('/')`); encode
    validates the segment shape per flavor (`refPathSchema`) and builds
    `db.doc(segments.join('/'))`.
  - Core query `__name__` (and docRef-field) filter operands are RefPath and
    the adapters encode them to `DocumentReference` values
    (`encodeFilterValue` in each codec, recursing into
    array/map/union-nested references), so every scope — collection,
    subcollection, collection group — takes the same operand form and the
    SDK's scope-dependent string conventions (plain id vs full path — see
    docs/querying-by-document-id.md) no longer surface. The old "plain id
    for a collection query" convenience is gone; a typed shorthand layer
    ("address accepted where a static context exists": bare id / `DocRef`
    tuple at surfaces whose collection is statically known) was judged
    FEASIBLE (the length parity 2n vs n disambiguates ids from segments once
    names are literal) and deliberately deferred.
  - `docRefValue(path)` takes the segment path (one signature, typed
    `DocRefType<'unknown'>`; comparisons key on the `'reference'` tag — a
    segment tuple alone cannot recover the `Collection` type, and no operator
    needs the precision). Decided (2026-07): the shorthand layer SHOULD add
    the collection+address form `docRefValue(authors, ['a1'])` typed
    `DocRefType<Authors>` — receiving the collection definition itself is
    what makes the known-collection typing possible.
  - Cursor constraints (`startAt` etc.) remain untyped raw pass-through
    (`Cursor` is `unknown[]`) — a reference cursor value would need the same
    encoding once cursors get typed.

## Expressions — remaining gaps

- [~] **Restructure the function-call AST into ONE `FunctionCall` class
  whose payload is a discriminated union with per-function parameters**
  (agreed 2026-07, deliberately deferred — do after the function slices).
  `FunctionCall<T>` carries `type: T` plus a `call` payload union —
  `{ name: 'timestampAdd'; value: Expression; unit: TimeUnit; amount: Expression } | { name: 'isType'; ... } | ...`
  — giving per-function structure WITHOUT per-function classes (classes
  exist for the instanceof brand the value nodes need; payloads inside one
  node need no brand). This REVERSES the earlier shape-grouped decision
  (one class per arity: `UnaryFunction` / `BinaryFunction` / ...), based on
  three distortions the arity buckets accumulated as slices 2–5 landed:
  1. **Dual-arity functions appear in TWO shape unions** (`round` / `trunc` /
     the `trim` family / `substring` / `timestampTruncate` /
     `timestampExtract` are both Binary and Ternary names) and force factory
     overloads. With a per-function payload the factory is a single
     `(a, b, c?)` signature — no overloads — and the payload holds the
     optional parameter as an optional field.
  2. **Positional payloads lose the meaning**: `TernaryFunction.first /
second / third` is (ts, unit, amount) for `timestampAdd` but
     (end, start, unit) for `timestampDiff`. Payload records carry named
     fields.
  3. **Backend-mandated literal arguments take a detour**: a literal (the
     `isType` type name, the timestamp unit/granularity/timezone) is lifted
     into a `Constant` operand only so the executors can recover the raw
     string from the AST node (`literalStringOperand`). A payload stores the
     literal AS a plain field and the whole recovery mechanism disappears.
     `Expression` stays `Field | Constant | FunctionCall | ...` (no 85-member
     union), and the executors keep exhaustiveness with one mapped table over
     all function names —
     `{ [K in FunctionName]: (call: Extract<FunctionPayload, { name: K }>) => SdkExpr }`
     — each entry typed against its own payload instead of a shared positional
     signature. Anything that would traverse operands generically must know
     payloads per name (today nothing does — executors translate per-function
     anyway).
     DONE (2026-07): all three distortions resolved — no factory overloads
     remain (dual-arity families are single `(a, b, c?)` signatures with
     optional payload fields), payloads carry named per-function fields, and
     backend-literal arguments (`typeName`, timestamp `unit` / `granularity`
     / `part` / `timezone`, map `key`) are plain payload fields with the
     whole `literalStringOperand` recovery mechanism deleted. Both executors
     dispatch through one `FunctionTranslators` mapped table via a generic
     helper — the correlated-union dispatch needed NO type assertion — and
     the gcloud `equalAny`-family options assertion fell away too (the d.ts
     does declare the array-expression overload; the earlier gap report
     missed it). Wire behavior verified unchanged by the full live catalog.
- [x] Per-op numeric return type refinement (Int64-pair → Int64 vs
      auto-widen to Double) — done in expressions slice 7 (`NumericResult`).
- [x] Improve `constant(value)` type inference from runtime value — see the
      expressions plan, slice 1.
- [ ] Tighten `arrayGet` return type via element typing.
- [ ] Tighten `mapGet` return type via key-aware lookup (subschema).
- [ ] Tighten `array(...)` / `map({...})` constructor return types from
      argument types.
- [ ] Decide long-term naming for the `array` / `map` collision against
      `schema.ts` (currently imported with `makeArrayType` / `makeMapType`
      aliases — see TODO at the top of `expression.ts`).
- [ ] Reference functions (`documentId` / `collectionId`) — settle DocRef
      expression typing.
- [ ] Sub-pipeline support: `let(...)` / `variable(name)` / `.toArrayExpression()`
      / `.toScalarExpression()` (joins).
- [ ] Vector functions: confirm dimension constraints if we want them in
      the type system.

## `Pipeline` runtime / serialization

- [x] **Decided: delegate execution to each package's SDK** (`db.pipeline()...`),
      NOT build our own proto/RPC. Each adapter walks our `Stage` AST into the
      SDK's pipeline builder. So there is **no wire-level proto / `_toProto`**
      work to do — the SDK serializes.
- [~] Walk the AST → SDK builder: done for `input` (collection) + `sort`. Each
  new stage/expression needs its translation added in both executors.
- [ ] `Expression` → SDK translation is minimal so far (only `field(path)` for
      sort orderings, via `expr.kind === 'field'`). `constant` / `functionCall`
      translation is not written yet.

## Per-SDK adapters (executor lives in each package's `pipeline.ts`)

- [x] `packages/firebase-js-sdk/src/pipeline.ts` — `executor(db)` over
      `@firebase/firestore/pipelines` (`execute` + `field`). Wired; not run live.
- [x] `packages/google-cloud-firestore/src/pipeline.ts` — `executor(db)` over
      `@google-cloud/firestore` `Pipelines` (`.execute()` + `Pipelines.field`).
      Verified live.
- [x] Shared spec `definePipelineSpecificationTests` in
      `src/__test__/pipeline-spec.ts`; called from both `index.test.ts`, gated on
      the enterprise env vars.

### Test infra: emulator + real Enterprise DB in one run

The repository tests run against the emulator; the pipeline tests need a real
Enterprise DB. They coexist because the constructed `pipeline` describe builds a
**separate** Firestore for the enterprise env (`FIRESTORE_REPOSITORY_INTEGRATION_TEST_*`):

- **google-cloud (admin):** reads `FIRESTORE_EMULATOR_HOST` **once, in the
  `Firestore` constructor** (`validateAndApplySettings`, frozen into
  `_settings`). So the pipeline describe temporarily `delete`s that env var,
  constructs the enterprise `Firestore`, then restores it — the emulator-bound
  repo `db` (built earlier) is unaffected. Verified safe.
- **firebase (client):** never reads `FIRESTORE_EMULATOR_HOST` at all (emulator
  is opt-in via `connectFirestoreEmulator`); the enterprise db simply doesn't
  connect to the emulator. No env juggling needed — but it needs real client
  credentials to actually reach the DB.
- The cleaner long-term option (not needed for correctness) is a dedicated
  vitest **project** with its own `test.env` (no emulator host) that includes
  only pipeline test files — the repo already uses `projects: ['packages/*']`.

### `execute` / `stream` capability asymmetry (verified against the SDKs)

The two SDKs differ on result materialization, mirroring their existing
Query API (admin has `query.stream()`, web only `getDocs()`):

| API         | `@firebase/firestore` (web, v4.16.0)                                   | `@google-cloud/firestore` (admin, v8.6.0)                                             |
| ----------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `execute()` | ✓ `Promise<PipelineSnapshot>` — all results materialized in `.results` | ✓ same — all results materialized                                                     |
| `stream()`  | ✗ **none** (only `execute`)                                            | ✓ `Pipeline.stream(): NodeJS.ReadableStream` emitting `PipelineResult`s incrementally |

- Both `execute()` paths hold **all results in memory** (`PipelineSnapshot.results: PipelineResult[]`), bounded by the pipeline's 128 MiB materialization limit.
- Implications for our API: make the **common** surface `execute()` (all-in-memory, both SDKs). Only the google-cloud adapter can add a streaming variant (e.g. `executeStream()` / async-iterator) — keep it adapter-specific, not part of the shared interface, so the web adapter isn't forced to fake it.

## Mapper reuse

- [ ] Align `IdentifiedPipelineResult<C>` with the existing `Doc<C>` shape
      enough that the existing `Mapper<C, AppModel>` can consume both.
- [ ] If needed, split `Mapper` into `IdentifiedMapper<C, AppModel>` (uses
      `id` / `ref`) and `FieldMapper<C, AppModel>` (data-only) so
      `UnidentifiedPipelineResult<C>` can still go through a mapper for
      field-only projection.
- [ ] `execute(pipeline).asyncMap(mapper)` (or similar) — convenience for
      mapping all results through a mapper.

## Tests

- [~] Behavioural spec (`pipeline-spec.ts`) with an `expectPipeline` helper
  (order-sensitive by default; `{ ordered: false }` for unordered inputs).
  Covers `fetch all` + `sort` asc/desc; add a case per new stage.
- [x] `fieldTypeOfPath` runtime resolver unit tests
      (`schema.field-type-of-path.test.ts`).
- [x] Identity ratchet integration test — confirm a `select` result lacks `id`
      at runtime (type side is covered by `pipeline.test.ts`).
- [ ] DML stage tests (`update` / `delete`).
- [ ] Sub-pipeline / join behavior tests once that's implemented.
- [x] **Method-level output-contract coverage in `pipeline.test.ts`** (audit
      2026-07). The `build*` schema operators are pinned exhaustively in
      `selection.test.ts`, but `pipeline.test.ts` is what proves each STAGE
      METHOD threads them through to `Pipeline<Schema, Id>` correctly — the
      output SCHEMA type, the IDENTITY (`Id`) behavior, and the stage-node
      payload. Every implemented method now has that three-way pin, to the
      reference shape `distinct` / `unnest` set (schema type via `SchemaOf`,
      identity via `RowOf` `toHaveProperty('id')` plus an assignability check,
      and the exact stage node via `stages()`). Scope: `pipeline.test.ts` only —
      the runtime/live behavior is covered elsewhere.

      | method                    | schema type | identity | stage node |
      | ------------------------- | ----------- | -------- | ---------- |
      | `collection`/`collectionGroup` | ✓      | ✓ preserve | ✓ (input node) |
      | `where`                   | ✓ unchanged | ✓ preserve | ✓        |
      | `sort`                    | ✓ unchanged | ✓ preserve | ✓        |
      | `limit` / `offset`        | ✓ unchanged | ✓ preserve | ✓        |
      | `select`                  | ✓           | ✓ drop   | ✓          |
      | `addFields`               | ✓           | ✓ preserve | ✓        |
      | `removeFields`            | ✓           | ✓ preserve | ✓        |
      | `aggregate`               | ✓           | ✓ break  | ✓          |
      | `distinct`                | ✓           | ✓ break  | ✓          |
      | `unnest`                  | ✓           | ✓ preserve | ✓        |

      One representative-but-real case per method proves the wiring (the full
      operator matrix stays in `selection.test.ts`); the shared `SchemaOf` /
      `RowOf` helpers are hoisted to the top of the `describe`.

## Docs

- [x] `docs/pipeline-query-identity-research.md` — empirical identity table
      and class-split design sketch.
- [ ] User-facing usage doc (README excerpt / examples) once the public
      surface is stable.

## Deferred backlog (cross-cutting; gathered so nothing lives only in chat)

Items agreed in discussion but previously recorded only inline in DONE notes
(or not at all). Elevated to checklist items:

- [~] **Shorthand layer — "an address where a static context exists".**
  SCOPED DOWN (2026-07): only the collection+address value constructor
  ships — `docRefValue(authors, ['a1'])`, typed `DocRefType<Authors>`
  (receiving the collection definition is what makes known-collection
  typing possible; segments are normalized internally, wire unchanged).
  REJECTED: core query `__name__` operands as bare ids or `DocRef`
  tuples. Bare ids are context-dependent (incomplete without the query
  parent; unexpandable for groups) — the guideline's "don't widen for
  possibly-invalid input". Address TUPLES would be sound (2n-vs-n length
  parity disambiguates), but the runtime dual interpretation gives one
  parameter two meanings a reader cannot tell apart without knowing the
  collection depth, for the price of one `refPath(...)` call — not worth
  the conceptual cost.
- [ ] **Typed cursor constraints.** `Cursor` is an untyped `unknown[]`
      pass-through; typing it per orderBy field would also require encoding
      reference cursor values like the filter operands
      (`buildEncodeFilterValue` precedent).
- [ ] **Identity-based `__name__` typing.** While a pipeline's read-identity
      is alive (`Id = DocRef<T>`) the source collection is statically known,
      so the field provider could resolve `'__name__'` to `DocRefType<T>`
      and fall back to `'unknown'` once the identity ratchet drops.
      Deferred alongside the DML-capability type-state work; `documentId()`
      covers today's uses.
- [ ] **`mapGet` dynamic-key overload.** The backend accepts a dynamic key
      expression (probed); the factory takes a literal for key-aware
      subschema typing. A dynamic overload would return the loose value
      union.
- [ ] **`mapSet` multi-pair form.** The SDK signature accepts
      `...moreKeyValues`; the factory supports a single key/value pair.
- [ ] **`int64`-asserting constant constructor** (e.g. `int64Value(2)`), if
      a need appears: number constants are uniformly `DoubleType` (the
      honest widening — a whole JS number wire-encodes as an integer
      anyway), which forfeits `NumericResult`'s int64 preservation when a
      constant operand is mixed in. No concrete need yet.
- [ ] **Run the firebase (client) adapter's pipeline suite live at least
      once** before the `pipeline-query` → `main` merge (needs
      `FIRESTORE_REPOSITORY_INTEGRATION_TEST_CLIENT_API_KEY`; the suite is
      skipIf-gated and has never executed against the real backend — the
      admin adapter covers the shared spec live today).
- [x] **Canonical union normalization — `UnionType` valid-by-construction**
      (done 2026-07). `Normalize` (type) / `normalize` (runtime twin) in
      `schema.ts`, composed of four steps each declared as its own type-level
      twin: `FlattenUnions` → `DedupDescriptors` → `DropNever` →
      `UnwrapSingleton`. Owned by `union()` / `nullable()`, which therefore
      return `Normalize<...>` and not necessarily a `UnionType` at all — so
      every `UnionType` in the system is canonical by construction and no
      caller re-normalizes. `descriptorEquals` / `DescriptorEquals` /
      `DedupDescriptors` moved down from `expression.ts` alongside them.
      The ad-hoc normalizers collapsed to `Normalize` compositions:
      `EitherType`, `LogicalExtreme`, `ElementUnion`, `ConcatElementUnion`,
      `ArrayConstantTypeOf`, `NullableStripped`, `StripNull`'s union arm,
      `PropagateNull` / `PropagateAbsence` / `MapValueType` /
      `RewriteAbsentField`; `RebuildUnion` deleted outright. Only
      `MapFieldUnion`'s TYPE stays bespoke — a record has no ordered key
      tuple, so it degrades to `AnyUnionType` by nature; its runtime now
      delegates. `arrayGet`'s nested-union pin flipped to flattened, and
      `nullable(nullable(x))` is idempotent. Recursion cost went DOWN
      (1.07M → 684K instantiations, 6.9s → 4.2s), since N conditional chains
      became one shared alias; no recursion bound was needed.
- [ ] **Refine accumulator nullability by groups presence** (noted 2026-07,
      explicitly deferred as advanced). `sum`/`average`/`minimum`/`maximum`/
      `first`/`last` are currently ALWAYS nullable — sound but wider than
      the true rule, `operandMayBeNull OR noGroups`: with groups, an empty
      group emits no row at all (probed), so a grouped aggregate over a
      non-null operand can never be null. Sketch: split the operand-derived
      nullability into a second type parameter
      (`AggregateFunction<T, MayBeNull>`, `T` the null-free value kind) and
      compose in the stage (`MayBeNull ? nullable(T) : HasGroups ? T :
nullable(T)`); count family unaffected. Also probe the un-probed
      all-null-group cell (nullable operand, every value null in a group)
      before relying on it.
- [ ] **Make "a selectable" a first-class concept** (agreed 2026-07, after the
      bare-`Field` selection landed). A `Field` is NOT a kind of
      `ExpressionWithAlias`: the latter is a BINDING (`{ expression, alias }`),
      the former is a NODE — different layers, so neither contains the other.
      What they share is "something that names ONE output", which the official
      SDK models as the `Selectable` interface that `Field` and
      `AliasedExpression` implement INDEPENDENTLY. This library has the same
      concept, but it is currently spelled as a type-erased implementation
      detail (`SelectionNode = string | Field | ExpressionWithAlias`; the string
      path is our third form, which the SDK lacks) — so the same "which output
      name, which schema contribution" judgment is re-derived at SIX sites: the
      types `SelectionPath` / `SelectionToSchema` / `UndottedGroupAliases`, the
      runtime `selectionPath` / `selectionToSchema`, and both executors'
      `toSdkSelectable`. Fix: promote the concept (name it for what it is, not
      for its erasure) and define its two operations — output path, and schema
      contribution — ONCE, with every call site delegating to them; the
      per-form arms then live inside those operations instead of being
      rewritten per site. NOT the alternative considered and rejected:
      normalizing `Field` into `{ expression: f, alias: f.path }` at the stage
      boundary — it collapses the node/binding layers to save arms, and it also
      loses what the user wrote in the stage payload. Also rejected: giving
      `Field` `expression`/`alias` members so it structurally satisfies
      `ExpressionWithAlias` — that would silently let a bare `Field` into
      `addFields`, whose bare-form exclusion is deliberate (see
      `BuildAddFieldsSchema`). Note one arm is irreducible: `UndottedGroupAliases`
      is a parameter intersection over the user's un-normalized tuple, so it
      must keep matching the input forms directly.

      **The invariant that makes this a concept and not a coincidence** (noted
      2026-07 while reviewing `unnest`): a bare `Field` and an
      `ExpressionWithAlias` are accepted TOGETHER at every site — `Selection`,
      `AggregateGroup`, `UnnestSelectable` — with `addFields` the lone
      exception, and it is not a counterexample: it excludes BARENESS as a
      category (the bare string form too), because a bare form names an
      EXISTING field, so re-adding it under its own name is a no-op at best and,
      through an optional map, silently materializes empty maps. So the real
      axis is not "`Field` vs aliased" but "bare (names an existing field) vs
      aliased (names a new output)". Under that framing the target shape falls
      out — one parameterized concept plus each site's own bare-string form and
      value constraint:

      ```ts
      type Selectable<Context, V extends FieldType = FieldType> =
        | Field<V, MapFieldPath<Context>>
        | ExpressionWithAlias<V>;

      type Selection<Context> = MapFieldPath<Context> | Selectable<Context>;
      type AggregateGroup<Context> = (keyof Context & string) | Selectable<Context>;
      type UnnestSelectable<Context> = Selectable<Context, ArrayValued>;
      // addFields stays ExpressionWithAlias[] — the documented bareness exclusion
      ```

      `unnest` made this a THIRD site spelling the same union by hand, so the
      duplication now costs more than when it was first noted.

- [x] **Align AST node names with the SDK's vocabulary** (done 2026-07):
      renamed the expression node `FunctionCall` → `FunctionExpression` (the
      SDK's name), so it pairs symmetrically with the `AggregateFunction` node;
      the discriminant `kind` follows (`'functionCall'` → `'functionExpression'`,
      mirroring `'aggregateFunction'`), as does the executor helper
      `dispatchFunctionCall` → `dispatchFunctionExpression`. The internal naming
      rule is now "SDK vocabulary", consistently.
- [ ] **`ArrayType` fixed-part / tuple support** — tracked in issue #218
      (includes the arrayRemove/arrayUnion interaction constraint noted
      there).

## Known issues / loose ends

- [ ] **The schema-level type logic needs careful human review.** The
      type-level transforms (e.g. `selection.ts`'s `BuildSelectionSchema` /
      `BuildAddFieldsSchema` / `MergeSchemas` / `PathToSchema`, and the
      `schema.ts` path helpers) are intricate and easy to get subtly wrong;
      review the resolved types against intended semantics before relying on
      them.
- [x] `pipelines/pipeline.test.ts` select-callback typecheck failures — cleaned
      up (moved to callback form; schema coverage lives in `selection.test.ts`).
- [x] `constant(value)` placeholder `type` — resolved by expressions slice 1
      (`ConstantTypeOf` / `constantTypeOf`).
- [ ] **Stale editor diagnostics:** the LSP may flag imports of
      `PipelineQueryExecutor` / `PipelineNode` etc. from
      `firestore-repository/pipelines/pipeline` as "no exported member". This is
      only the built `build/esm/*.d.ts` being out of date — `tsc`, `oxlint`, and
      `vitest` resolve to `src` via the `@firestore-repository/source` export
      condition, so it's harmless. Rebuild `firestore-repository` to clear it.
- [ ] firebase adapter's pipeline spec is unverified — the client SDK needs real
      firebase credentials (apiKey / security rules) to reach a non-emulator DB;
      ADC (which the google-cloud adapter uses) is not enough.
- [ ] Decide whether to expose the `pipelines` subpath in
      `packages/firestore-repository/package.json` `exports` (currently
      only the default entry is exported).
- Enterprise probe DB for empirical checks: `ikenox-sunrise` /
  `enterprise-native-playground` (Enterprise edition); ad-hoc probe scripts in
  `./.ikenox/` (gitignored). See the memory note `enterprise-probe-db`.
