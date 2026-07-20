# Pipeline Query — `aggregate` / `distinct` semantics

> Empirical study of the aggregate stage, its accumulator functions, and the
> `distinct` stage, probed against a real Firestore Enterprise database
> (2026-07, `.ikenox/probe-aggregate.mjs` / `probe-aggregate2.mjs`).

## Groups

- **Group keys are projected into the result rows** (the row carries which
  group it is), including aliased EXPRESSION groups
  (`greaterThan(field('n'), 4).as('big')` → rows `{ big: true, ... }` /
  `{ big: false, ... }`).
- **Null and ABSENT group keys merge into ONE group**, and the key appears
  in the row as `null` — the expression-side "absent merges into null" rule
  applies to grouping too. Consequence for typing: a group key whose
  descriptor is `X & Optional` reads back as `nullable(X)`, never absent.
- **Empty input**: with groups → **zero rows**; without groups → exactly ONE
  row (the whole-input group) carrying each accumulator's empty value.

## Accumulators — null / absent / error

| accumulator                               | null values                                 | absent values               | empty group (no-groups row)           |
| ----------------------------------------- | ------------------------------------------- | --------------------------- | ------------------------------------- |
| `sum` / `average` / `minimum` / `maximum` | ignored (avg divides by the non-null count) | ignored                     | **null** (NOT 0 for sum — unlike SQL) |
| `count(expr)`                             | not counted                                 | not counted                 | 0                                     |
| `countAll`                                | counts rows                                 | counts rows                 | 0                                     |
| `countDistinct`                           | (distinct non-null values)                  | —                           | 0                                     |
| `countIf(cond)`                           | a null condition is not true → not counted  | same                        | 0                                     |
| `first` / `last`                          | **kept** (positional, not skipped)          | **merged into null** (kept) | null                                  |
| `arrayAgg` / `arrayAggDistinct`           | **kept as elements**                        | **skipped**                 | (not probed; presumably empty/null)   |

- `first`/`last` follow the pipeline's `sort` order when one precedes the
  stage; without a sort the order is backend-determined. The keep-vs-skip
  claims were verified DISCRIMINATINGLY (`probe-first-last.mjs`): with a
  non-null neighbor adjacent to the null/absent end (`[null, y1, y2,
absent]` sorted), `first` returns null (a skip would return `y1`) and
  `last` returns null (a skip would return `y2`) — an arrangement where the
  null/absent element neighbors another null cannot tell the hypotheses
  apart.
- Note the asymmetry: `arrayAgg` SKIPS absent but KEEPS null, while
  `first`/`last` merge absent into null.
- **ERROR values inside an accumulator are not absorbed** — the query fails
  (`sum(divide(n, 0))` → INVALID_ARGUMENT), consistent with the expression
  error channel.

## Result kinds (probed via a following `addFields` + `type()`)

- `sum`: int64 when every input value is a wire integer, float64 when any
  double participates — the `NumericResult` rule.
- `average`: **always float64**.
- `count` / `countAll` / `countDistinct` / `countIf`: int64.
- `minimum` / `maximum` / `first` / `last`: the operand's own kind.

## Output shape restrictions (probed: `TOP_LEVEL_PROPERTY_PATH_ONLY`)

- **`aggregate` assigns TOP-LEVEL fields only**: a dotted bare-path group
  (`groups: ['a.b.c']`) AND a dotted alias (on a group or an accumulator)
  are both INVALID_ARGUMENT. A nested field groups via an expression with a
  top-level alias: `field('a.b.c').as('c')` — its rows carry `c: 'v1'` /
  `c: null`, with absent-ancestor docs merging into the null group like any
  other absent key. (The backend's backtick escape hatch — a literal dotted
  KEY — conflicts with the library's dotted-key ban and is not supported.)
- **A MAP-typed group key is compared and projected AS A VALUE**: inner
  absences are preserved (`{ b: {} }` and `{ b: { c: 'v1' } }` form
  DISTINCT groups); only the wholly-absent map merges into the null group.
  Library consequence: the `AbsentMergesIntoNull` rewrite is SHALLOW —
  nullable at the top of each group key, inner optionality untouched.

## `distinct` stage

- Same projection and null/absent-merge rules as grouping; expression
  aliases work. Semantically a grouped aggregate with zero accumulators —
  the library can share the groups machinery.

## Library consequences (design)

Return descriptors:

| factory                                                       | descriptor                                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `countAll()` / `count(v)` / `countDistinct(v)` / `countIf(c)` | `Int64Type` (0 on empty — never null)                                                         |
| `sum(v)`                                                      | `nullable(NumericResult<V>)` (the no-groups empty row)                                        |
| `average(v)`                                                  | `nullable(DoubleType)`                                                                        |
| `minimum(v)` / `maximum(v)` / `first(v)` / `last(v)`          | `nullable(WithoutOptional<V>)`                                                                |
| `arrayAgg(v)` / `arrayAggDistinct(v)`                         | `ArrayType<WithoutOptional<V>>`-based (elements may include null iff the operand may be null) |

Group-key schema: the groups' `BuildSelection` output with every
`X & Optional` field rewritten to `nullable(X)` (absent merges into null —
probed above).
