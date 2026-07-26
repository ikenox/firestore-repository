# Pipeline Query — `search` stage implementation plan

Working plan for the `search` transformation stage (full-text search on an
Enterprise database). Split out of [`pipeline-query.md`](./pipeline-query.md),
where `search` is one of the remaining stubs; status markers follow the same
conventions.

**Status: implemented and green, except the live spec** — the stage, its query
node, both executors and the type tests are in; the behavioural spec's cases are
written but `describe.skip`ped, because a text index cannot be created for the
per-run collection the rest of the spec uses. See the slices below.

The probe phase is done (one arm of #11 aside) —
results in
[`../pipeline-query-search-research.md`](../pipeline-query-search-research.md),
checklist in [Phase 0](#phase-0--probe-checklist-essentially-complete). The
design below is stated against those measurements, not against the SDKs'
declarations, which turned out to be much wider than the backend: three of the
pre-probe decisions were **reversed** by what the backend actually accepts. That
is the guideline's rule doing its job — a type model is a CLAIM about the
backend, never evidence of it.

## Scope

**In scope** — text search:

- the `search` stage itself (options, schema effect, identity, both executors)
- the `documentMatches` query node, and the score as the stage's `scoreAs`
  output (see decisions 8 / 9 — neither is an `Expression`)

**Out of scope, deliberately deferred** (not stubbed — a missing limb, not a
wrong skeleton):

- `geoDistance` + geospatial (`2dsphere`) indexes. The stage carries geospatial
  queries through the same `query` option, so the skeleton built here is the
  final one; the geo slice only adds one more expression factory.
- `matches(field, rquery)` (field-scoped full-text), `snippet(...)`,
  `between(...)`, `queryEnhancement`, `indexPartition`, and the search stage's
  `select` option. All are commented out in BOTH SDKs with
  `// TODO(search) enable with backend support`, so there is nothing to target.

## Grounding — the SDK surface

Both SDKs expose the stage identically:

```ts
Pipeline.search(options: SearchStageOptions): Pipeline;

type SearchStageOptions = StageOptions & {
  query: BooleanExpression | string;
  languageCode?: string;
  retrievalDepth?: number;
  sort?: Ordering | Ordering[];
  offset?: number;
  limit?: number;
  addFields?: Selectable[];
};
```

Search-only expressions that ARE declared (both SDKs):

| expression                         | returns             | notes                                                                                                                                  |
| ---------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `documentMatches(rquery)`          | `BooleanExpression` | full-text match over ALL text-indexed fields; declared `rquery` is `string \| Expression`, but the backend takes a string LITERAL only |
| `score()`                          | `Expression`        | relevance of the row to the query's text predicates; `0` when the query has no text predicate                                          |
| `geoDistance(fieldName, location)` | `Expression`        | meters; out of scope here                                                                                                              |

**The declarations are far wider than the backend.** Probing (see the research
doc) narrowed every option to a single shape:

| option           | SDK type                      | what the backend accepts                                     |
| ---------------- | ----------------------------- | ------------------------------------------------------------ |
| `query`          | `BooleanExpression \| string` | ONE `documentMatches(<string literal>)` (or a geo predicate) |
| `sort`           | `Ordering \| Ordering[]`      | exactly `score().descending()`, or nothing                   |
| `addFields`      | `Selectable[]`                | at most ONE `score().as(alias)`                              |
| `offset`         | `number`                      | only together with `limit`                                   |
| `retrievalDepth` | `number`                      | must be `>= offset + limit`                                  |

So typing this stage FROM the SDK's declarations would type-check a large family
of queries the backend rejects — the exact failure the guideline warns about.
The design below types the accepted domain instead.

Repository-side starting point: `stage.ts` has a payload-free
`{ kind: 'search' }` member, both executors throw on it, and `Pipeline.search`
is a commented-out stub.

## Settled design decisions

### 1. `search` is a plain `Pipeline` method — the head-only rule is NOT typed

Decided against modelling "must be the first stage" in the type system (the two
candidates were a dedicated `SourcePipeline` head class returned by the
`source.ts` factories, and a type-state third parameter on `Pipeline`).

The rule that governs this is the one already stated on `ExpressionBase.as`:
**ban what would silently succeed against the type model; leave loud failures
to the backend.** **CONFIRMED (probe #2):** every non-head placement is
rejected with `INVALID_ARGUMENT: search(...) must be the first stage after a
collection or collection_group stage.` — as loud as it gets. The restriction is
documented on the method's JSDoc; no type-level guard.

### 2. `query` is a dedicated `SearchQuery` node, NOT a boolean expression

**REVISED by probe #10.** `query` was to be typed
`Expression<Valued<'boolean'>>`; the backend accepts only a single
`document_matches` (or a geo predicate). `and` / `or` / `not` / comparisons /
`like` are all rejected, so a boolean-expression parameter would type-check a
whole family of queries that cannot run.

The honest type is a small closed union of its own:

```ts
type SearchQuery = DocumentMatches; // | GeoDistanceWithin, once the geo slice lands
```

The `and(...)` arm's message — "AND function in search(...) query is not
supported **yet**" — says this domain will grow, which a dedicated union
accommodates by adding a member.

The SDK's bare-`string` arm stays rejected as originally planned (it is sugar
for `documentMatches(str)`, and the guideline forbids widening for
convenience).

### 3. `documentMatches(rquery)` takes a string LITERAL

**REVERSED by probe #10.** The plan (and the earlier decision) was to accept an
`Expression`, with literal lifting. The backend refuses:

```
The 'query' argument of the 'document_matches' function must be a literal value, found: a property reference
The 'query' argument of the 'document_matches' function must be a string literal, found: NULL
```

so the payload holds a plain string, joining the backend-mandated-literal
precedent (`isType`'s type name, the map keys):

```ts
{
  kind: 'documentMatches';
  rquery: string;
}
```

The rquery DSL itself is documented in the research doc — note that the
official docs' `'a OR b'` does NOT work; disjunction is the space-less `a|b`.

### 4. `score()` — a double, reachable ONLY as the stage's single alias

**CONFIRMED + narrowed (probes #4/#5).** The value is a double. It is rejected
in every other stage AND in stages that FOLLOW the search, so the only place it
can appear is the stage's own `addFields` option — where the backend accepts
**at most one** `score().as(alias)` and nothing else:

```
search(...) only supports score() in addFields expression
Cannot have more than one field in a text search
```

Further pinned: the alias is mandatory (a bare `score()` crashes inside the
SDK), `'__name__'` is rejected, a colliding alias OVERWRITES the existing field,
and a **dotted alias returns `INTERNAL`** — a backend bug rather than a clean
rejection, so it is banned client-side via the existing
`UndottedSelectionAlias` guard (the `unnest` / `aggregate` / `distinct`
precedent).

### 5. Schema effect: ONE optional double field — the `addFields` reuse shrinks

**REVISED by probe #4.** Reusing `BuildAddFieldsSchema` verbatim was predicated
on the option being a general `addFields`; it is not. The whole schema effect is
"add one `double()` field under the score alias, overwriting a colliding field
shallowly" — expressible as a single-entry overlay through the existing
`MergeSchemas` machinery, with `Schema` unchanged when no alias is given.

### 6. Identity is PRESERVED

**CONFIRMED (probe #3):** result rows carry their source document's ref and full
data, so `Id` threads through unchanged. The usual ratchet applies downstream —
a `select` / `aggregate` / `distinct` after the search drops it as always
(probe #8).

### 7. `sort` carries a direction-bearing `SearchOrdering` — `Ordering` is NOT reused

**REVERSED by probe #6.** The backend rejects field orderings, `__name__`, a
mixed array, two orderings — and even `score().ascending()`:

```
search(...) with a document_matches query only supports sorting by score() in descending order.
```

So the option carries no ordering EXPRESSION. It does still carry a
**direction**, and that axis must not be collapsed to a boolean: the same
message says a geo query sorts by `geo_distance()` instead, and the geo slice
will need ASCENDING there. A boolean (`sortByScore: true`) would have to be
redesigned the moment that lands, which is the "wrong skeleton" the guideline
rules out. So the option is a small union that grows by adding a member:

```ts
type SearchOrdering = { by: 'score'; direction: 'descending' };
// later: | { by: 'geoDistance'; field: ...; direction: 'ascending' }
```

`'descending'` is the only direction the text arm accepts today; typing it as a
literal (rather than the general `'ascending' | 'descending'`) keeps the model
honest, and widening it later is non-breaking if the backend enables ascending.
Absent = the default order (document creation time, NEWEST first — pinned with
sequentially-written docs).

**This removes S1 from the critical path**: nothing in `search` needs a
computed-expression ordering, so the executors' field-only `toSdkOrdering` is
no longer a blocker. S1 remains a worthwhile independent improvement for the
`sort` STAGE, but it is no longer a prerequisite.

### 8. Public option names state what the backend does

The backend collapsed the SDK's `addFields` / `sort` to a single choice each, so
the option names say so rather than borrowing SDK vocabulary that would imply a
generality that does not exist (`addFields: Selectable[]` reading as a list when
exactly one score alias is legal):

```ts
source.search((field) => ({
  query: documentMatches('waffles'),
  scoreAs: 'relevance', // optional; undotted, at most one — it IS the addFields option
  sort: { by: 'score', direction: 'descending' }, // optional; absent = newest first
  limit: 10,
}));
```

This is the one deliberate departure from the "SDK vocabulary" naming rule, and
it is the same trade the rule itself is for: names should describe the thing
they name. Recorded here so it is not mistaken for an oversight.

The options are accepted **either directly or through the `(field) => spec`
callback**, because the rule the callback actually encodes — visible across the
existing stages — is "the callback exists to hand over the typed field
accessor": the stages that need no field access (`limit`, `offset`,
`removeFields`) already take plain arguments. A text query needs none
(`documentMatches` takes a literal), so requiring `() =>` for it would be the
deviation; a geospatial query names the field it measures from, so it will need
the callback. Accepting both is what lets the geo slice land without changing
this signature.

### 9. `SearchQuery` / score are NOT `Expression` members

Both follow the `AggregateFunction` precedent — a node deliberately outside the
`Expression` union, so misplacing one is a COMPILE error rather than a backend
error:

```ts
type SearchQuery = DocumentMatches; // | GeoDistanceWithin, later
source.where((f) => documentMatches('x')); // type error
```

This is stricter than decision 1's "leave loud failures to the backend", and
deliberately so: the rule there is about restrictions the type system cannot
express cheaply, whereas this one it expresses for free, with an existing
precedent. The score does not need a node at all under decision 8 — it is the
`scoreAs` alias — so only `SearchQuery` gets one.

### 10. Stage payload

```ts
| {
    kind: 'search';
    query: SearchQuery;
    scoreAs?: string; // undotted, guarded at the Pipeline method
    sort?: SearchOrdering;
    languageCode?: string;
    retrievalDepth?: number;
    offset?: number;
    limit?: number;
  }
```

`offset` is accepted only together with `limit` (backend rule, expressible at
the type level as a paired parameter); the `retrievalDepth >= offset + limit`
rule is a numeric relation between runtime values and stays with the backend.

## Phase 0 — probe checklist (essentially complete)

Empirical study against the Enterprise probe DB (`ikenox-sunrise` /
`enterprise-native-playground`), driven by `.ikenox/probe-search.mjs` — whose
sections A–M can be run individually (`node .ikenox/probe-search.mjs C D`) —
and written up in
[`../pipeline-query-search-research.md`](../pipeline-query-search-research.md),
following the `unnest` / `replaceWith` / `aggregate` research docs. The fixture
is the `TextSearchTest` collection with a text index on its `text` field.
Results are summarized here; the doc carries the detail and the verbatim error
messages.

- [x] **#1 Index creation + freshness.** Index created by hand out of band (the
      CLI path is still undocumented — see the risks). Freshness measured:
      write → searchable **50 ms** on the first poll, delete → reflected **0 ms**.
      Effectively synchronous, so the live spec can seed per run like every
      other pipeline test.
- [x] **#2 Placement.** Every non-head placement rejected: `INVALID_ARGUMENT:
search(...) must be the first stage after a collection or collection_group
stage.` — loud, so decision 1 (no type-level guard) stands.
- [x] **#3 Identity.** Rows carry their source ref and full data → identity
      PRESERVED (decision 6).
- [x] **#4 `addFields` option rules.** Only `score()` is accepted, at most ONE,
      alias mandatory, `__name__` rejected, colliding alias overwrites, dotted
      alias returns `INTERNAL`. → decision 5 shrank accordingly; the dotted
      alias is banned client-side.
- [x] **#5 `score()` descriptor.** A double; reachable ONLY through the stage's
      own `addFields` (rejected even in stages that follow the search).
- [x] **#6 Default order.** Creation time, NEWEST first (pinned with
      sequentially-written docs). `sort` accepts `score().descending()` and
      literally nothing else — not even `score().ascending()`. → decision 7
      reversed.
- [x] **#7 `limit` / `offset` / `retrievalDepth`.** `offset` requires `limit`;
      `retrievalDepth >= offset + limit`; `limit: 0` / `retrievalDepth: 0` mean
      UNSET, not "no rows"; the stage's `limit` composes with a later `limit`
      STAGE.
- [x] **#8 Downstream stages.** `where` / `select` / `addFields` / `sort` /
      `limit` / `aggregate` / `distinct` / `unnest` all work after a search,
      with their usual identity behaviour.
- [x] **#9 Search-only expressions outside the stage.** `INVALID_ARGUMENT: The
'document_matches' / 'score' function can only be used in the search(...)
stage.` — loud, and it also applies to stages AFTER the search. Pins the
      wire names `document_matches` / `score`.
- [x] **#10 Supported query expressions.** ONE `documentMatches` with a string
      LITERAL. `and` ("not supported yet") / `or` / `not` / comparisons /
      `like` / a non-constant rquery are all rejected. → decisions 2 and 3
      revised.
- [~] **#11 Scope + missing index.** Missing/building index →
  `FAILED_PRECONDITION: No matching search index found for query.` — the
  shape the live spec's gating recognizes. Collection-group search returns
  the same error against a collection-scoped index, so it needs a
  **collection-group-scoped text index** to be answered. STILL OPEN.
- [x] **#12 `languageCode`.** `'en'` / `'ja'` / `'sr'` / `''` accepted; `'zz'`
      → `INVALID_ARGUMENT: Unsupported language_code: zz`. No observable effect
      on the ASCII fixtures.

## Slices

- [x] **S0 — probe + research doc.** →
      [`../pipeline-query-search-research.md`](../pipeline-query-search-research.md).
      Everything except the collection-group arm of #11 is answered.
- [-] **S1 — computed-expression orderings in both executors.** No longer on
  this feature's critical path (decision 7: `search` needs no ordering
  expression at all). Still worth doing for the `sort` STAGE, tracked in
  `pipeline-query.md` rather than here.
- [x] **S2 — the `SearchQuery` node.** `pipelines/search.ts`: `DocumentMatches`
      (`{ kind: 'documentMatches'; rquery: string }`), the `documentMatches`
      factory and `SearchOrdering`, all OUTSIDE the `Expression` union
      (decision 9). `pipeline.test.ts` pins that a query is unusable in `where`
      / `select`. No `score` node — the score is the `scoreAs` alias
      (decision 8).
- [x] **S3 — the stage.** `stage.ts` payload, `Pipeline.search` +
      `SearchSpec` / `SearchPaging`, `SearchSchema` / `buildSearchSchema` in
      `selection.ts` (the single-field score overlay), `Id` threading, the
      undotted-alias guard (`UndottedIndexField` generalized to
      `UndottedOptionalKey`, now shared with `unnest`), and both executors'
      `applyStage` arms — translating `scoreAs` back to
      `addFields: [score().as(alias)]` and `sort` to `score().descending()`,
      which is where the SDK vocabulary is re-entered. `pipeline.test.ts` has
      the three-way pin every stage method has (schema type / identity / stage
      node) plus the four compile-time rejections; `selection.test.ts` pins
      `buildSearchSchema` against oracles.
- [~] **S4 — live spec + test infrastructure.** The cases are written in
  `pipeline-spec.ts` but the block is `describe.skip` — they need an indexed
  fixture that does not exist yet (see below). Enabling it is the remaining
  work.
- [-] **S5 — README + `packages/readme-example`.** Only the stage list in the
  Pipeline operations overview gains `search`. **No per-stage section**: the
  README documents pipelines at overview level, and a section for one stage
  would sit at the wrong altitude — there is no stage catalog to belong to,
  and the API is close enough to the official SDK's that per-stage prose
  adds little. Consumer-facing detail lives in the JSDoc instead. With no
  README snippet to verify, `readme-example` gains nothing either.
- [x] **S6 — doc updates.** `pipeline-query.md` status table and stage
      checklist updated, and `pipeline-query-spec-coverage-gap.md` has a
      `search` section recording which of the 16 considerations are live-GAPed
      by the skipped spec (10), TYPE-ONLY (5), or unit-pinned (1).

Deferred, tracked here so it does not live only in chat:

- [ ] **Geospatial slice.** `geoDistance(field, geoPoint)` + a `2dsphere` index
      on the probe DB. The docs say only `<=` is supported on the distance,
      while the SDK's own example uses `lessThan` — probe before typing it.

## Test plan

Type-level (`pipeline.test.ts` / `expression.test.ts`):

- the stage method's three-way pin — output schema type, identity, stage node —
  matching the reference shape `distinct` / `unnest` set
- the score field's descriptor in the output schema, and the undotted-alias
  guard (`@ts-expect-error`)
- the `query` parameter rejects anything but a `SearchQuery`
  (`@ts-expect-error` on a boolean expression, so the narrowing of decision 2 is
  pinned)

Live (`pipeline-spec.ts`). The one structural constraint: **a text index is
created per collection ID, so the search tests cannot use `uniqueCollection(...)`
like the rest of the spec.** Everything else turned out easy — indexing is
effectively synchronous (probe #1), so the tests seed per run as usual.

- [ ] a FIXED collection whose text index is created once, out of band, on the
      probe DB — the creation steps belong in this doc, since it is a manual
      prerequisite
- [ ] cross-run isolation on that fixed collection: tag each run with a token
      that participates in the query — rquery terms AND together, so
      `documentMatches('<token> waffles')` isolates cleanly without a wipe
- [ ] a small retry helper around the first search after seeding (cheap
      insurance; probe #1 measured 50 ms, but on one sample)
- [ ] `skipIf` gating so the suite is skipped (not failed) when the fixture /
      index is absent — the recognizable shape is `FAILED_PRECONDITION: No
matching search index found for query.`

Every rule S3 encodes needs a live test, per the guideline: the score overlay
(incl. the overwriting collision), identity preservation, the default
creation-time-newest-first order, score-descending order, `limit` / `offset`
paging, the `offset`-without-`limit` and `retrievalDepth` rejections, the
rquery DSL forms (AND / phrase / exclusion / the space-less `a|b` disjunction),
and the loud failure of a misplaced `search`.

## Known unknowns / risks

1. **Text index creation appears to be console-only.** The fixture's index
   (`TextSearchTest.text`) was created by hand; no `gcloud`/REST path for text
   indexes is documented. The live spec therefore depends on a manual setup
   step, whose exact click-path belongs in this doc before S4 lands.
2. **Collection-group search is unanswered** — it needs a
   collection-group-scoped text index, which the fixture does not have. Until
   then the library should not claim `collectionGroup(...).search(...)` works.
3. **The SDKs' search surface is `@beta`** and half of it is commented out
   pending backend support; the backend is visibly mid-rollout (`AND function in
search(...) query is not supported yet`, and a dotted score alias returning
   `INTERNAL`). The accepted domain will grow, so prefer shapes that grow by
   adding a union member.
4. **The official docs are wrong about the rquery DSL** (`'a OR b'` does not
   disjoin; `a|b` does), so the JSDoc must document the probed forms, not the
   documented ones.
