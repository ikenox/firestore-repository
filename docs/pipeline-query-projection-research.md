# Pipeline Query — projection (`select` / `add_fields`) semantics

> Empirical study of how Firestore Pipeline projection stages shape their
> output rows and validate their inputs. Companion to
> [`pipeline-query-identity-research.md`](./pipeline-query-identity-research.md)
> (which covers `id` / `ref` / metadata preservation).
>
> Probed 2026-07 against a real Firestore Enterprise database
> (`ikenox-sunrise` / `enterprise-native-playground`) via
> `@google-cloud/firestore@8.6.0`, and — where noted — via the raw
> `documents:executePipeline` REST API to rule out SDK behavior.

## The wire model: every selection is `{ outputName: expression }`

A `select` / `add_fields` stage's argument is a proto **map** from output name
to expression. There is no "un-aliased" selection at the wire level — the
SDK's bare-string form is pure client-side sugar:

```js
// selectablesToMap (SDK): a string becomes alias = s, expression = Field(s)
{ "meta.x": { fieldReferenceValue: "meta.x" } }
```

Verified by serializing the stage protos: `select('meta.x')`,
`select(field('meta.x'))`, and `select(field('meta.x').as('meta.x'))` are
**byte-identical**. (`Field` itself implements `Selectable`, with its own path
as the alias.) Consequently "aliased vs un-aliased" has no backend meaning —
what matters is only whether the output name equals the source path
(cf. the reserved-field rules in the identity research doc).

## Dotted output names: intermediate layers always materialize

A dotted output name (`'a.b.c'`) produces **nested maps**, not a literal
dotted key — and the intermediate layers are materialized **even when the
source has no value**; only the **leaf** is conditionally absent:

| case                                  | doc has the path         | doc lacks the path        |
| ------------------------------------- | ------------------------ | ------------------------- |
| `select('a.b.c')`                     | `{ a: { b: { c: 1 } } }` | `{ a: { b: {} } }`        |
| `select('a.b.c.d')` (nothing exists)  | —                        | `{ a: { b: { c: {} } } }` |
| `select('meta')` (whole optional map) | `{ meta: {...} }`        | `{}` — key absent         |
| `field('meta.x').as('mx')`            | `{ mx: 1 }`              | `{}` — key absent         |

This is **backend behavior, not the SDK's**: the raw REST `executePipeline`
response already contains the nested, materialized structure, and the SDK has
no dot-splitting / nesting logic anywhere.

Implications for the schema model:

- Intermediate layers of a dotted selection are **required** in the projected
  schema, even when the source map was optional — the projection moves
  optionality **from the ancestors onto the leaf**
  (`{ meta?: { x } }` --select('meta.x')--> `{ meta: { x?} }`).
- Selecting a whole optional map by key keeps the key optional (absent when
  the source lacks it).
- As of this writing the library does **not** yet propagate ancestor
  optionality to the leaf — tracked in
  [#202](https://github.com/ikenox/firestore-repository/issues/202) with
  skipped red tests.
- The backend output erases the distinction between "parent missing" and
  "parent present but leaf missing" — both yield materialized-empty parents.
  The library deliberately models the wire shape as-is (source-modal
  normalization, if ever wanted, belongs to the mapper layer).

## Conflicting output names: the official stack rejects, the library resolves

For selections **within one stage's argument list** whose output names
collide (equal, or one a dotted prefix of the other):

| conflict within the args          | SDK                                         | Firestore backend                                                                                                                                                 | this library |
| --------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| same output name twice            | **throws** (`Duplicate alias or field '…'`) | not expressible (proto map keys are unique)                                                                                                                       | last-wins    |
| prefix overlap (`'a'` vs `'a.b'`) | passes through                              | **`INVALID_ARGUMENT`** — "attempting to set a parent document and one of its child fields simultaneously", in **both orders**, for both `select` and `add_fields` | last-wins    |

So **last-wins is a library extension, not an official behavior** — every
within-args conflict is an error somewhere in the official stack. The library
resolves conflicts client-side (`dropOverriddenSelections`, applied when the
stage node is built) so the backend never sees them; the rationale is builder
composability (later additions to a selection list win). This also means the
pre-drop is load-bearing: forwarding the raw list would turn calls the types
declare valid into runtime errors.

Note this is only about conflicts **within** one stage's arguments. An
`add_fields` output name overlapping an **existing document field** is the
normal, officially-supported case — see below.

## `add_fields` vs existing fields: deep merge, added wins

| case                                                  | result                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| new top-level name                                    | added alongside existing fields                                |
| dotted name under an existing map (`'profile.score'`) | **deep merge** — existing `profile` fields kept, new key added |
| same name as an existing leaf                         | added value replaces it                                        |
| same name as an existing **map**, non-map value       | the whole map is replaced by the value                         |
| within-args conflicts                                 | rejected by SDK/backend, exactly as for `select` (table above) |

Matches the SDK's documented "overwrite existing ones" phrasing, refined:
the overwrite is **per-leaf** (nested maps merge), not per-top-level-key,
unless the added value itself is not a map.

The dotted-name materialization rule applies to `add_fields` too:
`addFields(field('meta.x').as('meta.x'))` on a document **without** `meta`
adds `meta: {}` to the row — a self-alias of an existing path is therefore
NOT a no-op when the path crosses an optional map. This is why the library
rejects bare field paths in `addFields` at the type level (its schema would
compute "unchanged" while the row mutates); the official SDK's `addFields`
accepts only `Selectable`s as well (probed via `probe-addfields-barepath.mjs`).

## How these findings were obtained

Ad-hoc probe scripts (gitignored) under `./.ikenox/`:
`probe-name-alias.mjs`, `probe-optional-map-select.mjs`,
`probe-optional-map-deep.mjs`, `probe-optional-alias.mjs`,
`probe-deep-nonexistent.mjs`, `probe-add-fields.mjs`,
`probe-prefix-conflict.mjs`, `probe-proto-equivalence.mjs`,
`probe-field-selectable.mjs` — plus one raw REST call to
`documents:executePipeline` to bypass the SDK entirely.
