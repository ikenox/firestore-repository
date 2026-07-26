# Pipeline Query — `search` semantics

> Empirical study of the `search` stage (full-text), probed against a real
> Firestore Enterprise database (2026-07, `.ikenox/probe-search.mjs`).
>
> Fixture: collection `TextSearchTest` with a **text index on its `text`
> field**, docs `d1`..`d4` (all sharing the term `menu`), `d5` (NO `text`
> field), `d6` (`text: null`), plus `o1`..`o3` written sequentially for the
> ordering probe.

**Headline: the backend accepts far less than the SDKs' types suggest.** The
declared `SearchStageOptions` looks like a general stage — a boolean `query`,
`Ordering[]`, `Selectable[]` — but every one of those is narrowed to a single
shape by the backend:

| option           | SDK type                      | what the backend actually accepts                            |
| ---------------- | ----------------------------- | ------------------------------------------------------------ |
| `query`          | `BooleanExpression \| string` | ONE `documentMatches(<string literal>)` (or a geo predicate) |
| `sort`           | `Ordering \| Ordering[]`      | exactly `score().descending()`, or nothing                   |
| `addFields`      | `Selectable[]`                | at most ONE `score().as(alias)`                              |
| `offset`         | `number`                      | only together with `limit`                                   |
| `retrievalDepth` | `number`                      | must be `>= offset + limit`                                  |

So `search` is not "a stage with a filter, a sort and a projection" — it is
**"run this one text query, optionally newest-first or score-first, optionally
labelling the score"**. The library's types should say that; typing the options
from the SDK's declarations would type-check queries the backend rejects, which
is exactly the failure mode the guideline warns about.

## Placement: `search` must directly follow the input stage

Every non-head placement is rejected loudly, with one message:

```
INVALID_ARGUMENT: search(...) must be the first stage after a collection or
collection_group stage.
```

Probed rejections: `where` → `search`, `limit` → `search`, `sort` → `search`,
`addFields` → `search`, `select` → `search`, and `search` → `search`.

The message names **`collection` / `collection_group` specifically**, so the
other input sources presumably cannot head a search pipeline either (unprobed —
they are not implemented yet).

## Search-only expressions are rejected outside the stage

```
INVALID_ARGUMENT: The 'document_matches' function can only be used in the search(...) stage.
INVALID_ARGUMENT: The 'score' function can only be used in the search(...) stage.
```

Probed in `where`, `addFields`, `sort`, `select` — and notably **also in stages
that follow the search** (`search().addFields(score())` is rejected too, so the
score is reachable ONLY through the stage's own `addFields` option).

Both restrictions therefore stay out of the type system, per "ban what would
silently succeed against the type model; leave loud failures to the backend".
Incidentally this pins the wire names: `document_matches`, `score`.

## Identity is PRESERVED

Result rows carry their source document's ref, and the full document data. The
usual ratchet then applies downstream: `select` / `aggregate` / `distinct`
after a search drop the ref as always.

## `query`: one `documentMatches` with a string LITERAL

```
INVALID_ARGUMENT: search(...) only supports 'document_matches' or distance based
searches like lte(geo_distance(field(STRING), GEO_POINT), NUMBER) but got <expr>
```

| query expression                              | result                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| `documentMatches('...')`                      | OK                                                                                   |
| `documentMatches(constant('...'))`            | OK (same thing — the SDK lifts the literal either way)                               |
| `documentMatches(field('text'))`              | **rejected**: "must be a literal value, found: a property reference"                 |
| `documentMatches(stringConcat(...))`          | **rejected**: "The 'string_concat' function cannot be used in the search(...) stage" |
| `documentMatches(constant(null))`             | **rejected**: "must be a string literal, found: NULL"                                |
| `documentMatches('')`                         | OK, 0 rows                                                                           |
| `or(documentMatches, documentMatches)`        | **rejected** (not in the supported set)                                              |
| `not(documentMatches(...))`                   | **rejected**                                                                         |
| `and(documentMatches, anything)`              | **rejected**: "AND function in search(...) query is not supported yet"               |
| `equal(field('rank'), 1)` (no text predicate) | **rejected**                                                                         |
| `like(field('text'), '%waffles%')`            | **rejected**: "The 'like' function cannot be used in the search(...) stage"          |
| `field('rank')` (non-boolean)                 | **rejected**: "Expected query to be FUNCTION_VALUE"                                  |
| omitted entirely                              | SDK-side crash (undefined value)                                                     |

Two consequences for the design:

- **`rquery` is a plain string literal, not an expression.** The payload takes
  `rquery: string`, joining the backend-mandated-literal precedent (`isType`'s
  type name, the map keys) rather than holding an `Expression`. This REVERSES
  the earlier decision to accept an expression.
- **`query` is not a boolean expression either.** Typing it
  `Expression<Valued<'boolean'>>` would admit `and` / `or` / `not` /
  comparisons, all of which the backend rejects. The honest type is the
  `documentMatches` node itself (a geo predicate would be a second member once
  the geo slice lands). The AND arm's "not supported **yet**" suggests the
  domain will grow — a dedicated `SearchQuery` union is the shape that can grow
  with it.

### The rquery DSL

| form                | meaning                                       |
| ------------------- | --------------------------------------------- |
| `waffles`           | single term                                   |
| `waffles coffee`    | AND (both terms required)                     |
| `"belgian waffles"` | exact phrase                                  |
| `coffee -waffles`   | exclusion                                     |
| `waffles\|pancakes` | **OR** — the pipe, with NO surrounding spaces |

**The official docs' `documentMatches('waffles OR pancakes')` does not work**:
`OR` / `or` are matched as ordinary terms (0 rows), as is `waffles | pancakes`
with spaces and `(waffles OR pancakes)`. Only the space-less `a|b` disjoins.

Only text-INDEXED fields are searched: a term present only in an unindexed
field (`rank`, or the map `m.k`) matches nothing. Rows whose `text` is absent
(`d5`) or `null` (`d6`) simply never match — no error.

## `score()`: a double, only via the stage's `addFields`

- The value is a JS `number` (double), e.g. `1.9531786441802979` for the
  triple-`waffles` doc vs `1.2588917016983032` for the single-term one.
- **At most ONE score alias**: two `score().as(...)` in one stage →
  `INVALID_ARGUMENT: Cannot have more than one field in a text search`.
- **An alias is mandatory** — a bare `score()` crashes inside the SDK
  (`Cannot read properties of undefined (reading '_validateUserData')`).
- **A dotted alias (`score().as('x.y')`) triggers `INTERNAL: An internal error
occurred.`** — a backend bug, not a clean rejection. Ban it client-side, the
  same way `unnest` / `aggregate` / `distinct` ban dotted output names
  (`UndottedSelectionAlias`).
- **`__name__` as the alias** is rejected: "Stage 'search': field name
  '**name**' is reserved and can not be overwritten."
- An alias colliding with an existing field **overwrites it** (a `text` alias
  replaces the document's `text` with the score; an `m` alias replaces the whole
  map). Added-field-wins, exactly like `addFields` — but SHALLOW, and only ever
  for this one field.
- Any non-`score()` expression is rejected: `search(...) only supports score()
in addFields expression`. So the option is not `addFields` at all.
- The score is `0.33974558115005493` for every row matching the shared single
  term `menu` — equal scores across rows, which is what makes the default
  ordering observable (below).

## Ordering

- **Default (no `sort`): document creation time, NEWEST first.** Pinned with
  three sequentially-written docs `o1` < `o2` < `o3` by `createTime`, which come
  back `o3, o2, o1`; the batch-written `d*` docs (identical `createTime`) then
  follow in descending key order.
- **`sort` accepts `score().descending()` and nothing else.** A field ordering,
  `__name__`, a mixed array, a second ordering, and even
  `score().ascending()` are all rejected:

  ```
  INVALID_ARGUMENT: search(...) only supports sorting by geo_distance() for
  geo_distance queries or score() for text search queries.
  INVALID_ARGUMENT: search(...) with a document_matches query only supports
  sorting by score() in descending order.
  ```

- `sort: []` and the single-element array form both behave as expected (empty =
  default order).
- A `sort` STAGE **after** the search works normally and re-orders the rows.

## `limit` / `offset` / `retrievalDepth`

- `offset` without `limit` → `INVALID_ARGUMENT: search(...): 'offset' cannot be
used without 'limit'.`
- `retrievalDepth` must satisfy `retrievalDepth >= offset + limit`, else
  `INVALID_ARGUMENT: search(...): 'retrievalDepth' must be greater than or equal
to 'offset' + 'limit'.`
- `limit: 0` and `retrievalDepth: 0` are treated as UNSET (all rows come back),
  not as "zero rows".
- `offset: 1, limit: 2` pages as expected within the default order.
- The stage's own `limit` composes with a later `limit` STAGE (search's applies
  first).

## Stages after `search`

All probed stages work, with their usual identity behaviour: `where`, `select`
(ref dropped), `addFields`, `sort`, `limit`, `aggregate` (ref dropped),
`distinct` (ref dropped), `unnest`. The only thing that cannot follow a search
is a search-only EXPRESSION (see above).

## Scope, indexes, `languageCode`

- **Missing / still-building index** → `FAILED_PRECONDITION: No matching search
index found for query. Please create a search index that covers all fields used
in the search query.` The live spec's gating has to recognize this shape.
- **collection group**: the same `FAILED_PRECONDITION` — the fixture's index is
  collection-scoped, so this probes the index's scope rather than the stage's
  capability. A collection-group-scoped text index is needed before this can be
  answered. **OPEN.**
- `languageCode`: `'en'`, `'ja'`, `'sr'`, `''` accepted; `'zz'` →
  `INVALID_ARGUMENT: Unsupported language_code: zz`. No observable effect on
  these ASCII fixtures.

## Index freshness

Measured by `.ikenox/probe-search.mjs` section A (write a doc with a unique
token → poll until it matches → delete → poll until it stops matching):

- **write → searchable: 50 ms**, on the FIRST poll
- **delete → reflected: 0 ms**, on the first poll

So indexing is effectively synchronous with the write, at least at this
fixture's scale. **The live spec can seed per run** like every other pipeline
test, instead of needing a pre-seeded never-mutated fixture — the one thing
that would have made a `search` spec structurally different from the rest.

Caveat: a single sample on a tiny, idle index. A retry helper is still the
prudent shape for the live spec (it costs nothing when the first attempt
succeeds), but the seeding strategy does not have to change.

## Open

- collection-group search (needs a collection-group-scoped text index)
- geospatial: `geoDistance` queries and `2dsphere` indexes (out of scope for
  the current slice)
- whether `database()` / `documents()` / `literals()` can head a search
  pipeline (those sources are unimplemented)
