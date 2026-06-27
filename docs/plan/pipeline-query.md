# Pipeline Query — implementation plan

Working checklist for the Firestore Pipeline Query support. Detailed design is
intentionally out of scope here; this doc is for tracking what needs to be in
place and the status of each piece.

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

## Identity ratchet (split `Pipeline` into two classes)

- [ ] Rename current `Pipeline<Context>` to base class
      `UnidentifiedPipeline<Context>`.
- [ ] Introduce `IdentifiedPipeline<Context> extends UnidentifiedPipeline<Context>`.
- [ ] Override identity-preserving methods (`where`, `sort`, `limit`,
      `offset`, `addFields`, `removeFields`, `unnest`) on
      `IdentifiedPipeline` to narrow the return type back to
      `IdentifiedPipeline`.
- [ ] Leave `select` / `distinct` / `aggregate` / `replaceWith` unoverridden
      so they fall through to the base and yield `UnidentifiedPipeline`.
- [ ] `pipelineQuery(collection)` returns `IdentifiedPipeline<C>`.
- [ ] `literals(...)` source factory returns `UnidentifiedPipeline<C>`.
- [ ] Type-level tests covering the ratchet across each method.

## `PipelineResult` types

- [ ] `UnidentifiedPipelineResult<Context>` — only `data()`-equivalent
      access, no identity fields.
- [ ] `IdentifiedPipelineResult<Context> extends UnidentifiedPipelineResult<Context>`
      with `id: string` / `ref: DocumentReference` / `createTime: Timestamp`
      / `updateTime: Timestamp` (all non-optional).
- [ ] `execute()` overrides on the two pipeline classes that return the
      matching result type.
- [ ] Decide shape compatibility with existing `Doc<C>` so `Mapper` reuse
      is straightforward (see "Mapper reuse" below).

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
- [ ] `Pipeline.execute()` — actually call the backend
      (`ExecutePipeline`) and convert the response into `PipelineResult`s.
- [ ] Decide whether to delegate execution to the per-package SDK
      (`@firebase/firestore/pipelines`, `@google-cloud/firestore/pipelines`)
      or build our own RPC client.

## Per-SDK adapters (mirrors existing repository setup)

- [ ] `packages/firebase-js-sdk/src/pipelines.ts` — wire `Pipeline.execute()`
      against `@firebase/firestore/pipelines.execute`.
- [ ] `packages/google-cloud-firestore/src/pipelines.ts` — wire against
      `@google-cloud/firestore/pipelines`.
- [ ] Shared spec tests (in `packages/firestore-repository/src/__test__`)
      that both adapters must satisfy.

## Mapper reuse

- [ ] Align `IdentifiedPipelineResult<C>` with the existing `Doc<C>` shape
      enough that the existing `Mapper<C, AppModel>` can consume both.
- [ ] If needed, split `Mapper` into `IdentifiedMapper<C, AppModel>` (uses
      `id` / `ref`) and `FieldMapper<C, AppModel>` (data-only) so
      `UnidentifiedPipelineResult<C>` can still go through a mapper for
      field-only projection.
- [ ] `pipeline.execute().asyncMap(mapper)` (or similar) — convenience for
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
