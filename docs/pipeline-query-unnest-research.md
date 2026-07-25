# Pipeline Query — `unnest` semantics

> Empirical study of the `unnest` stage, probed against a real Firestore
> Enterprise database (2026-07, `.ikenox/probe-unnest.mjs`).

`unnest(selectable, indexField?)` emits one row per element of the array the
selectable evaluates to, augmenting the input row with the element under the
selectable's ALIAS (and the element's offset under `indexField`).

## Identity

- **Read-identity is PRESERVED**: every emitted row carries its source
  document's `ref`. Unlike `select` / `aggregate` / `distinct`, `unnest` does
  not break identity.
- **But ids are no longer unique across rows**: a document with an n-element
  array yields n rows that all carry the SAME id. Identity here means "this row
  came from that document", not "one row per document".

## Row shaping

- **The source field survives**: unnesting `t` under the alias `e` leaves `t`
  (the whole array) in the row alongside `e`.
- **Aliasing onto the source's own name replaces it**: `field('t').as('t')`
  yields rows whose `t` is the ELEMENT, with no trace of the array. Same for
  the un-aliased form.
- **An un-aliased bare `Field` works**, keyed by its own path — the `Field`-is-
  a-selectable model, consistent with `select` / groups.
- **The index field overwrites a colliding existing field** (`indexField: 'n'`
  replaces the document's `n`).
- Net effect on the schema: the alias (and the index field) are overlaid on the
  input context, added-field-wins — i.e. exactly `addFields` semantics.

## Output shape restrictions (`TOP_LEVEL_PROPERTY_PATH_ONLY`)

- A **dotted alias** and a **dotted `indexField`** are both INVALID_ARGUMENT —
  the same restriction `aggregate` / `distinct` have.
- The **SOURCE path may be dotted**: `field('m.k').as('e')` unnests a nested
  array fine. Only the OUTPUT name is restricted to top level.

## Non-array / empty / null / absent

The SDK's own doc comment says a non-array value makes the stage "a no-op ...
returning it as is with the `alias` field absent". **The probe contradicts
that** — the alias is set to the value:

| source value    | rows emitted | alias                                   | index field |
| --------------- | ------------ | --------------------------------------- | ----------- |
| `['a','b']`     | 2            | `'a'` / `'b'`                           | `0` / `1`   |
| `['p', null]`   | 2            | `'p'` / `null` (null ELEMENTS are kept) | `0` / `1`   |
| `[]` (empty)    | **0**        | —                                       | —           |
| `null`          | 1            | **`null`**                              | **`null`**  |
| `7` (non-array) | 1            | **`7`**                                 | **`null`**  |
| absent          | 1            | **absent**                              | **`null`**  |

- So the no-op row passes the VALUE through to the alias; only a genuinely
  absent source leaves the alias absent.
- **The index field is always present on emitted rows**, `null` on every no-op
  row — including the absent-source row, where the alias itself is absent. The
  two do not travel together.
- An empty array emits nothing at all, so a row whose source was a real array
  always has a real (int64) index.

## Library consequences (design)

Schema: the input context with the alias overlaid (added-field-wins,
`addFields`-shaped), plus the index field when requested.

| source descriptor    | alias descriptor | index descriptor    |
| -------------------- | ---------------- | ------------------- |
| `array(E)`           | `E`              | `int64()`           |
| `nullable(array(E))` | `nullable(E)`    | `nullable(int64())` |
| `optional(array(E))` | `E & Optional`   | `nullable(int64())` |

(The non-array-scalar column has no row: a typed selectable is array-valued by
construction, so that cell is unreachable through the library.)

Identity: preserved (`Id` threads through), with the duplicate-id caveat above.
