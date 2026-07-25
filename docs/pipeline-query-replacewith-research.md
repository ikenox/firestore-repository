# Pipeline Query — `replaceWith` semantics

> Empirical study of the `replaceWith` stage, probed against a real Firestore
> Enterprise database (2026-07, `.ikenox/probe-replacewith.mjs`).

`replaceWith` reshapes a document from a MAP value. The wire `replace_with`
stage takes `args: [map, mode]` — and the backend supports **THREE modes**
(probed by rawStage; the backend enumerates them in its rejection message:
`Valid options are: [full_replace, merge_overwrite_existing, merge_keep_existing]`).
The SDK's typed `replaceWith` HARDCODES `full_replace` and exposes no mode
parameter, so the merge modes are reachable only through a raw stage
(`rawStage('replace_with', [mapExpr, constant(mode)])`) — a documented,
backend-validated capability, not a guess.

## The three modes

| mode                       | schema effect                                                                          | identity                      |
| -------------------------- | -------------------------------------------------------------------------------------- | ----------------------------- |
| `full_replace`             | the document BECOMES the map; every original field dropped                             | **BROKEN** (`Id = undefined`) |
| `merge_overwrite_existing` | the map merged onto the existing document, **the map wins** a top-level collision      | **PRESERVED**                 |
| `merge_keep_existing`      | the map merged onto the existing document, **the existing wins** a top-level collision | **PRESERVED**                 |

Probed with existing `{ a:1, b:2, n:{p:10,q:20} }` and new map `{ a:99, c:7, n:{p:999,r:3} }`:

- `merge_overwrite_existing` → `{ a:99, b:2, c:7, n:{p:999,r:3} }` — `a` overwritten, `b` kept, `c` added, and the colliding map key `n` is **REPLACED WHOLESALE** (`q:20` is gone). The merge is **SHALLOW**: a top-level collision takes the whole winning value; there is no deep map merge (contrast `addFields`, whose dotted aliases DO deep-merge).
- `merge_keep_existing` → `{ a:1, b:2, c:7, n:{p:10,q:20} }` — existing `a` and `n` kept, only the non-colliding `c` added.
- Both merge modes keep the row's `ref` and leave `__name__` addressable afterward — identity threads through, unlike `full_replace`.

The stub's `MergeMode = 'overwrite' | 'keep'` corresponds exactly to
`merge_overwrite_existing` / `merge_keep_existing`; `mergeWith` was NOT baseless.

**An absent/null map source under a merge mode is a NO-OP** (probed:
`probe-rw-optional-merge.mjs`). Merging `field('m')` where `m` is absent (`d2`)
or `null` (`d3`) leaves the document UNCHANGED — no keys to merge, original
kept, identity preserved. Only a present map contributes its keys. Contrast
`full_replace`, where an absent/null map → empty document. Schema consequence
for a merge with an optional/nullable map source: the existing schema is always
preserved, and the overlaid (map-only) keys are each present iff the map is
present → OPTIONAL. The definite-map case (a `map({...})` literal or a required
map field) merges cleanly with no added optionality.

## Identity — depends on the mode

- **`full_replace` BREAKS identity, totally**: every emitted row has NO `ref`
  (probed — `[no ref]` on all rows), and projecting `field('__name__')` AFTER
  the stage yields nothing. The emitted map IS the whole document — no id at
  all, not even a re-addressable `__name__`. So `Id = undefined`.
- **Both merge modes PRESERVE identity**: the row keeps its `ref` and
  `__name__` stays addressable — the document is reshaped in place, not
  re-emitted. So `Id` threads through unchanged.

## The map source

- **A map-valued EXPRESSION** (`replaceWith(map({ who: field('name'), ... }))`)
  → the document becomes exactly that map's key/value pairs. The result schema
  is the map expression's field record.
- **A field NAME** (`replaceWith('parents')`) → the document becomes the map
  AT that field. It is the special case of the expression form where the
  expression is a bare field reference to a map-typed field.

## Non-map / absent source → EMPTY document

- When the replacement value is not a map — ABSENT (`d2`, no `parents`), NULL
  (`m: null`), or a NON-MAP scalar (`d3`, `parents: 'scalar'`) — `replaceWith`
  emits an **empty document `{}`**: not an error, not the scalar/null. ALL
  three non-map cases degrade identically to the empty document (probed:
  `probe-replacewith.mjs`, `probe-replacewith2.mjs`).
- **The source path may be DOTTED**: `replaceWith('deep.inner')` and
  `replaceWith(field('deep.inner'))` both replace with the nested map at that
  path. Only the RESULT is a fresh top-level document; the source is read by an
  ordinary (possibly nested) field reference.
- Library consequence: a typed callback constrained to a map-valued expression
  cannot express the plain non-map case, but it DOES surface through an OPTIONAL
  map field — a row whose source map is absent replaces to `{}`. So each field
  of the result schema is present iff the source map is present: when the
  replacement map can be absent, the result fields read back OPTIONAL (an
  all-or-nothing-per-row optionality, soundly over-approximated as each field
  independently optional).

## Library consequences (design)

The callback returns a map-valued expression `Expression<MapType<M>>`; the
bare-field-reference case (`f('parents')`, `f('deep.inner')`) covers the
field-name and dotted forms.

- **`full_replace`** → `Pipeline<M, undefined>` (identity break; schema is
  exactly the map's field record `M`, with each field made optional when the
  map source can be absent/null).
- **`merge_overwrite_existing`** → `Pipeline<MergeSchemas<M, Schema>, Id>`
  (identity preserved; the map's fields overlaid on the existing schema, `M`
  wins a top-level collision — the same shape as `addFields`, but a SHALLOW
  merge and driven by a whole map expression rather than aliased fields).
- **`merge_keep_existing`** → `Pipeline<MergeSchemas<Schema, M>, Id>` (identity
  preserved; existing wins a top-level collision).

Executor: `full_replace` can use the SDK's `replaceWith(mapExpr)`; the two merge
modes must go through `rawStage('replace_with', [mapExpr, constant(mode)])`
(the SDK hardcodes `full_replace`). Both adapters need a raw-stage escape hatch
for the merge modes — confirm the firebase client SDK exposes `rawStage` too.
