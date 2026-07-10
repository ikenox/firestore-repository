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
- [`../pipeline-query-projection-research.md`](../pipeline-query-projection-research.md) — `select` / `add_fields` output shaping (dotted-name materialization, conflict rejection vs the library's last-wins, add_fields merge rules).

## Current status (snapshot — read this first)

**What actually runs today (verified against a real Enterprise DB):**

- `collection(def)` → `execute` returns all documents with their ids
  (a bare collection input, no transformation stages).
- `collection(def).sort((field) => [asc(field('rank')), desc(...)])`
  → sorted results.

Both work end-to-end through **both** adapters' executors; the spec suite
(`fetch all` + `sort` asc/desc) passes against
`ikenox-sunrise` / `enterprise-native-playground` via the google-cloud (admin,
ADC) adapter. The firebase (client) adapter is wired identically but has **not**
been run live — the client SDK needs real firebase credentials (apiKey / rules)
to reach a non-emulator DB.

**How the runtime AST works now** (the key shift this session):

- `Pipeline` methods used to all return `unimplemented()` (no runtime value).
  Now `collection`/`collectionGroup` build an input stage carrying the
  source (`{ kind: 'collection', collection }` — see `stage.ts` `InputSource`),
  and **`sort` builds a real `{ kind: 'sort', orderings }` stage** linked to its
  parent. **All other stages are still stubs** (`unimplemented()`), so a chain
  like `.where(...).sort(...)` does NOT build a runtime AST yet — only
  `input` and `sort` do.
- The `parent` link is typed as `PipelineNode` (a methods-free structural view
  of `Pipeline`) so `Pipeline<Schema, Id>` — which is invariant in `Schema` —
  is assignable without a cast. An executor walks `parent` to collect stages.
- `Field` gained `kind: 'field'` → `Expression` is now a discriminated union
  (`field` / `constant` / `functionCall`). New `field(type, path)` factory in
  `expression.ts`. The `sort` field provider resolves each field's real runtime
  `type` via the new **`fieldTypeOfPath(schema, path)`** in `schema.ts` (the
  runtime counterpart of the `FieldTypeOfPath` type), covered by
  `schema.field-type-of-path.test.ts`.
- `select` / `addFields` / `distinct` use `const` type params, so callback
  selections infer as tuples without `as const`. `select` is fully implemented
  (bare paths, nested dotted paths, `.as(...)` aliased expressions, last-wins
  conflicts) and verified live; every expression node now carries an SDK-style
  `.as(alias)` producing an `ExpressionWithAlias`.

**Executors** (`packages/{firebase-js-sdk,google-cloud-firestore}/src/pipeline.ts`):
`executor(db)` walks the stage chain into `db.pipeline()...`, translates `sort`
to `field(path).ascending()/.descending()`, runs it, and converts each result
via the existing per-adapter `fromFirestore.docRef` / `decode` (both now
exported through `buildFirestoreUtilities`, with an added `decode` method).

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

**Type assertions used** (all the `decode` class — runtime value → schema-derived
type; policy in `docs/coding-guideline.md`): `fieldTypeOfPath` (2: `MapType`
narrowing + the `FieldTypeOfPath` bridge) and each executor's result map
(1 each: `... as PipelineResult<Schema, Id>`). The parent-invariance and the
field-provider casts were **eliminated** (via `PipelineNode` and the resolver).

**Repo state:** core `firestore-repository` is green (lint 0, fmt clean, 210
tests pass). Adapter repository tests still need the emulator (not run in this
snapshot). Ad-hoc probe scripts live in `./.ikenox/` (gitignored).

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

- [ ] `where(condition)` — real runtime + AST node + tests.
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

- [x] `sort(...)` — **implemented end-to-end** (identity- and schema-preserving).
      `Pipeline.sort` builds `{ kind: 'sort', orderings }`; both executors
      translate to `field(path).ascending()/.descending()`. Only **field**
      orderings are supported (a computed-expression ordering throws in the
      executor). Verified live. See the spec `sort` tests.
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

- [ ] **Restructure `FunctionCall` into shape-grouped classes when the ~85
      factories return.** Decided design (2026-07): don't do one class per
      function (SDK-style, ~85 classes, giant `Expression` union) and don't
      keep the current single `FunctionCall` with untyped `args: Expression[]`
      (forces runtime arity guards in every executor — see
      `toSdkFunctionCall`'s `left === undefined` checks). Instead, one class
      per **shape** (`UnaryFunction` / `BinaryFunction` / `VariadicFunction` /
      individual classes for irregulars like `findNearest` / `cond`), each
      with typed payload fields (`left` / `right` / `operands`) and a
      per-shape `name: <Shape>FunctionName` string-literal union. - Executors then translate each shape with a
      `Record<BinaryFunctionName, (l, r) => SdkExpr>` lookup table — the
      `Record` requires every key, giving the same exhaustiveness guarantee
      as `assertNever` without per-function `case`s, and the arity guards
      disappear into the types. - Rationale: a Visitor and a `name` string-union switch are the same
      case-analysis over a closed sum (same side of the expression problem);
      the only substantive win available is typed payloads, and shape
      granularity gets it with ~5 classes instead of ~85. Per-function
      individuality (operand/return typing like `equal`'s overloads) stays
      in the factory signatures.
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
- Note: `pipeline.test.ts` (type-level) tests only the identity ratchet on
  `base` / `select` / `removeFields`; the `select` output-schema transforms live
  in `selection.test.ts`. Only bare string-path selections compile today (no
  `.as(...)`).

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
- [x] `pipelines/pipeline.test.ts` select-callback typecheck failures — cleaned
      up (moved to callback form; schema coverage lives in `selection.test.ts`).
- [ ] `constant(value)` still uses a placeholder `type` (`'todo' as unknown as T`,
      with a lint-disable). TODO: derive the `FieldType` from the runtime value
      (number → Double, string → String, ...). Needed before `constant` /
      `functionCall` expressions can be serialized to the SDK.
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
