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

Related research / decisions:

- [`../pipeline-query-identity-research.md`](../pipeline-query-identity-research.md) — which stages preserve `id` / `ref` / `createTime` / `updateTime`.

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
      AST + ~85 function factories covering all SDK expression categories
      except aggregate / sort (deferred — see sections below).
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
- [x] Source factories set the initial `Id`: `pipelineQuery` / `collection` /
      `subcollection` / `collectionGroup` → `DocRef<T>` (collectionGroup assumes
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

Input stages:

- [ ] `collection(path | CollectionRef)` — returns `IdentifiedPipeline<C>`
      where `C` comes from the collection's schema.
- [ ] `collectionGroup(id)` — pipe id; identity-preserving start.
- [ ] `database()`.
- [ ] `documents([...refs])`.
- [ ] `subcollection(...)` (matches `schema.ts`'s subcollection model).
- [ ] `literals([...])` — `UnidentifiedPipeline<C>` (no source docs).

Transformation stages already stubbed:

- [ ] `where(condition)` — real runtime + AST node + tests.
- [ ] `select(...)` — runtime + identity break + tests.
- [ ] `addFields(...)` — Context augmentation + identity preserve.
- [ ] `removeFields(...)` — Context shrinkage + identity preserve.
- [ ] `distinct(...)` — Context shrinkage + identity break.
- [ ] `limit(N)` / `offset(N)` — Context unchanged + identity preserve.
- [ ] `unnest(...)` — Context augmentation + identity preserve.
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

- [ ] `sort(...)` — needs `Ordering` type (returned by
      `ascending()` / `descending()`) plus a sort stage that does not change
      Context but preserves identity.
- [ ] `aggregate(...)` — needs:
  - A separate `AggregateFunction` AST node (distinct from `Expression`).
  - Aggregate function factories: `sum`, `count`, `countAll`,
    `countDistinct`, `countIf`, `average`, `first`, `last`, `minimum`,
    `maximum`, `arrayAgg`, `arrayAggDistinct`, `arraySum`.
  - `aggregate({ accumulators, groups })` stage that:
    - rebuilds Context from accumulator aliases + group field types,
    - breaks identity (returns `UnidentifiedPipeline`).
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

## Expressions — remaining gaps

- [ ] Per-op numeric return type refinement (Int64-pair → Int64 vs
      auto-widen to Double) — TODO comments already in `expression.ts`.
- [ ] Improve `constant(value)` type inference from runtime value
      (`number → DoubleType`, `string → StringType`, ...).
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

- [ ] Walk the `Pipeline` AST to produce the wire-level proto:
      `[Stage, ...]` with each Stage's `_toProto`-equivalent shape.
- [ ] Serialize `Expression` AST (FunctionCall / Field / Constant) to the
      backend proto format. Use the SDK proto as reference.
- [ ] `execute(pipeline)` (standalone function) — actually call the backend
      (`ExecutePipeline`) and convert the response into `PipelineResult`s.
- [ ] Decide whether to delegate execution to the per-package SDK
      (`@firebase/firestore/pipelines`, `@google-cloud/firestore/pipelines`)
      or build our own RPC client.

## Per-SDK adapters (mirrors existing repository setup)

- [ ] `packages/firebase-js-sdk/src/pipelines.ts` — provide the adapter's
      `execute(pipeline)` against `@firebase/firestore/pipelines.execute`.
- [ ] `packages/google-cloud-firestore/src/pipelines.ts` — wire against
      `@google-cloud/firestore/pipelines`.
- [ ] Shared spec tests (in `packages/firestore-repository/src/__test__`)
      that both adapters must satisfy.

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

- [ ] Spec tests for each implemented stage's behavior (against the
      emulator-substitute / real Enterprise DB if needed).
- [ ] Identity ratchet integration test — confirm
      `IdentifiedPipeline` → `select` → `UnidentifiedPipeline`'s result
      lacks `id` at both type and runtime levels.
- [ ] DML stage tests (`update` / `delete`).
- [ ] Sub-pipeline / join behavior tests once that's implemented.

## Docs

- [x] `docs/pipeline-query-identity-research.md` — empirical identity table
      and class-split design sketch.
- [ ] User-facing usage doc (README excerpt / examples) once the public
      surface is stable.

## Known issues / loose ends

- [ ] **The schema-level type logic needs careful human review.** The
      type-level transforms (e.g. `selection.ts`'s `BuildSelectionSchema` /
      `BuildAddFieldsSchema` / `MergeSchemas` / `PathToSchema`, and the
      `schema.ts` path helpers) are intricate and easy to get subtly wrong;
      review the resolved types against intended semantics before relying on
      them.
- [ ] `pipeline-query.test.ts` (now `pipelines/pipeline.test.ts`) has a few
      WIP test cases that still fail typecheck after recent select-callback
      refactors. Clean up when stage signatures settle.
- [ ] `PipelineQuery` -> `Pipeline` rename has propagated; verify no stale
      references remain across docs / comments.
- [ ] Decide whether to expose the `pipelines` subpath in
      `packages/firestore-repository/package.json` `exports` (currently
      only the default entry is exported).
