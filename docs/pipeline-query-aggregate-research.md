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
  stage; without a sort the order is backend-determined.
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
