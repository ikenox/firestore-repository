# Pipeline Query — Result identity per stage

> Empirical study of which Firestore Pipeline stages preserve `PipelineResult`'s
> document identity fields (`id`, `ref`, `createTime`, `updateTime`).
>
> Probed against a real Firestore Enterprise database via
> `@google-cloud/firestore@8.3.0`.

## Why this matters

`PipelineResult` (both `@firebase/firestore` and `@google-cloud/firestore`)
exposes `id` / `ref` / `createTime` / `updateTime` as `string | undefined` /
`DocumentReference | undefined` / `Timestamp | undefined`. Whether they are
populated is **decided server-side per result** — the backend either returns a
key for the row or it does not — and the SDK simply mirrors that:

```js
// @firebase/firestore: pipelines.esm.js
e.key?.path ? new DocumentReference(...) : void 0
```

So "does my pipeline return ids?" is purely a function of the stages, and the
official docs do not enumerate which ones break identity. This document
records the observed behavior so we can encode it in the
`firestore-repository` type system.

## Result

| Stage                      | n (results) | id  | ref | createTime | updateTime | Notes                                                                                                                                                                                                                      |
| -------------------------- | ----------- | --- | --- | ---------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collection()` (baseline)  | 4           | ✓   | ✓   | ✓          | ✓          |                                                                                                                                                                                                                            |
| `where(...)`               | 2           | ✓   | ✓   | ✓          | ✓          |                                                                                                                                                                                                                            |
| `sort(...)`                | 4           | ✓   | ✓   | ✓          | ✓          |                                                                                                                                                                                                                            |
| `limit(N)`                 | 2           | ✓   | ✓   | ✓          | ✓          |                                                                                                                                                                                                                            |
| `offset(N)`                | 3           | ✓   | ✓   | ✓          | ✓          |                                                                                                                                                                                                                            |
| `addFields(...)`           | 4           | ✓   | ✓   | ✓          | ✓          | Keeps identity even after deriving new fields.                                                                                                                                                                             |
| `removeFields(...)`        | 4           | ✓   | ✓   | ✓          | ✓          |                                                                                                                                                                                                                            |
| `unnest(...)`              | 6           | ✓   | ✓   | ✓          | ✓          | **Same `id` repeated across the rows produced by one source document.**                                                                                                                                                    |
| `select(...)`              | 4           | ✗   | ✗   | ✗          | ✗          | Drops identity for ordinary field projections. **But selecting the reserved `__name__` / `__create_time__` / `__update_time__` fields un-aliased preserves the corresponding metadata — see the dedicated section below.** |
| `distinct(...)`            | 2           | ✗   | ✗   | ✗          | ✗          |                                                                                                                                                                                                                            |
| `aggregate` (no groups)    | 1           | ✗   | ✗   | ✗          | ✗          |                                                                                                                                                                                                                            |
| `aggregate` (with groups)  | 2           | ✗   | ✗   | ✗          | ✗          |                                                                                                                                                                                                                            |
| `replaceWith(...)`         | 4           | ✗   | ✗   | ✗          | ✗          |                                                                                                                                                                                                                            |
| `where → select`           | 2           | ✗   | ✗   | ✗          | ✗          |                                                                                                                                                                                                                            |
| `select → where`           | 2           | ✗   | ✗   | ✗          | ✗          |                                                                                                                                                                                                                            |
| `aggregate → sort → limit` | 2           | ✗   | ✗   | ✗          | ✗          |                                                                                                                                                                                                                            |

## Summary

- **Identity-preserving stages**: `where`, `sort`, `limit`, `offset`,
  `addFields`, `removeFields`, `unnest`.
- **Identity-breaking stages**: `distinct`, `aggregate` (with or without
  groups), `replaceWith`, and `select` **unless** it carries the reserved
  `__name__` / `__create_time__` / `__update_time__` fields un-aliased (see the
  dedicated section below).
- **Identity does not recover** once truly dropped: every downstream result is
  missing `id` / `ref` / `createTime` / `updateTime`. The lone exception is
  `select` re-attaching metadata via the reserved fields, but only if those
  fields were carried through every preceding projection (`select → where` with
  an ordinary projection still loses identity).

## Surprises vs. naive expectation

- `select` is identity-breaking **for ordinary field projections** — the
  backend drops the row's key for `select("name")` and even for
  `documentId(field("__name__")).as("docId")` (wrapped + renamed). **However**,
  selecting the reserved metadata fields _un-aliased_ preserves the matching
  identity — see "select and the reserved metadata fields" below. So `select`
  is conditionally, not unconditionally, identity-breaking.
- `addFields` / `removeFields` are identity-preserving. So
  **"keep identity while reshaping fields" should be done via
  `addFields` / `removeFields`, not `select`.**
- `unnest` keeps the source document's id on every emitted row. The same
  `id` therefore appears multiple times when one document has multiple array
  elements — useful for "explode" patterns where you want to know which
  source document each emitted row came from.

## `__name__` is a REFERENCE value, not a string

Probed (2026-07, `probe-slice3.mjs`): `type(field("__name__"))` is
`"reference"`, and the reference-domain functions accept it while rejecting
strings (`documentId(constant("authors/a1"))` →
`INVALID_ARGUMENT: requires \`Reference\` but got \`STRING\``). Comparisons
are total, so an `equal(field("**name**"), <string>)` would silently be
always-false — a trap, not an error.

Comparison semantics (probed 2026-07): the pipeline backend never converts —
`equal(__name__, <string>)` is `false` for EVERY string form (the bare id,
the relative path, the full resource path), and only a reference constant
matches (`constant(db.doc(...))` in the SDK / `docRefValue(collection, id)`
in this library). The core query API's `where(eq('__name__', '1'))` accepting
a string is an SDK convenience: the core query has a collection context to
convert the string into a reference before it hits the wire; a pipeline has
none, so the raw type shows through.

A projected raw key (`field("__name__").as("k")`) materializes in the SDK as
a `DocumentReference` instance (NOT a path string — an earlier note here was
imprecise).

Library consequence: `FieldTypeOfPath` resolves `'__name__'` to the
context-free reference descriptor `DocRefType<'unknown'>` (`schema.ts` —
ONE unified descriptor; the type parameter is the referenced collection when
the schema knows it, or the `'unknown'` sentinel when it does not) with the
`'reference'` firestoreType tag, so string comparisons and string functions
over the raw key are rejected at the type level; `documentId(field('__name__'))` /
`collectionId(...)` bridge it into the string domain, and
`docRefValue(collection, id)` is the matching comparand. The context-free
flavor's `output` is `string`: the core query API's id-filter contract, and
the decode of a projected raw key (the codecs decode the
`DocumentReference` to its relative path string; a schema-known
`docRef(collection)` field decodes to a `DocRef` id tuple as usual), and its
`input` is likewise the relative path string (encoded via `db.doc(path)`).

### Core query `__name__` string filters

Full probe results (root collection / subcollection / collection group ×
bare id / relative path / `DocumentReference`, incl. range operators) live in
[querying-by-document-id.md](./querying-by-document-id.md). The design
takeaway: "core query accepts strings for `__name__`" is really two
different client-side conveniences keyed to the source's static scope
(collection query → bare id; collection group → root-relative path), both
compiled to a reference before hitting the wire. The reference VALUE is the
one wire-level concept; address-style strings are only accepted where a
static context exists to resolve them.

## Read-identity (row key) vs. `__name__` field / DML-capability

Two distinct notions are easy to conflate:

- **Read-identity** — whether `PipelineResult.id` / `ref` / `createTime` /
  `updateTime` are populated. This is driven by the result row's
  server-assigned **key** (`e.key?.path`). A `documentId(field("__name__")).as("docId")`
  projection (wrapped + renamed) does **not** bring it back, but selecting the
  raw `field("__name__")` un-aliased **does** (see the dedicated section below).
- **DML-capability** — whether an `update` / `delete` stage may be appended.
  The [Pipeline DML docs](https://firebase.google.com/docs/firestore/pipelines/dml)
  require the documents entering the DML stage to include the `__name__`
  **field**, and allow only these stages before DML: `collection`,
  `collection_group`, `where`, `select`, `add_fields`, `remove_fields`, `let`,
  `sort`, `limit`, `offset` — disallowing `aggregate`, `distinct`, `unnest`,
  `find_nearest`, and multi-query (`union` / joins / sub-queries).

These two axes do **not** line up:

- `select` is read-identity-breaking but DML-allowed (as long as `__name__` is
  kept in the projection).
- `unnest` is read-identity-preserving but DML-disallowed (one source document
  fans out to many rows, so the key is no longer 1:1).

So **DML-capability must be modeled as its own type state**, separate from the
read-identity (`Id`) parameter.

## `select` and the reserved metadata fields (`__name__` / `__create_time__` / `__update_time__`)

`select` can re-attach result **metadata** by projecting reserved fields. The
rule is symmetric across all three and depends on whether the field keeps its
reserved name:

| projection (inside `select`)                | `id`+`ref` | `createTime` | `updateTime` | lands in `data` as  |
| ------------------------------------------- | ---------- | ------------ | ------------ | ------------------- |
| `field("__name__")` (un-aliased)            | ✓          | —            | —            | — (consumed)        |
| `field("__create_time__")` (un-al.)         | —          | ✓            | —            | — (consumed)        |
| `field("__update_time__")` (un-al.)         | —          | —            | ✓            | — (consumed)        |
| all three un-aliased                        | ✓          | ✓            | ✓            | — (consumed)        |
| `field("__name__").as("__name__")`          | ✓          | —            | —            | — (consumed)        |
| `field("__name__").as("docId")`             | ✗          | —            | —            | `docId` (reference) |
| `field("__create_time__").as("ct")`         | —          | ✗            | —            | `ct` (Timestamp)    |
| `documentId(field("__name__")).as("docId")` | ✗          | —            | —            | `docId`             |

Key points (probed on `enterprise-native-playground`, `@google-cloud/firestore@8.6.0`):

- **Kept under its reserved name** (un-aliased, or `.as` back to the same
  reserved name), each magic field restores its **result metadata** and
  contributes nothing to `data`.
- **Renamed** to any other alias, the field's value is projected into `data` as
  an ordinary field (a path string for `__name__`, a `Timestamp` for the time
  fields) and the metadata is **not** restored.
- Wrapping in an expression (e.g. `documentId(...)`) and renaming also fails to
  restore metadata.
- **Overwriting a reserved name with any other value is an error** (probed
  2026-07): `field("name").as("__name__")` →
  `INVALID_ARGUMENT: Stage 'select': field name '__name__' is reserved and can
not be overwritten.` — the `.as("__name__")` row in the table above works
  only because the source is `field("__name__")` itself. The repository
  deliberately does **not** guard this (neither type- nor runtime-level): the
  backend's own validation is authoritative and fails loudly, so a client
  check would only duplicate it. The guiding rule: type-ban only what would
  **silently succeed** against the type model (bare `'__name__'` selections,
  which re-attach identity while `select` claims `Id = undefined`); leave
  loud failures to the backend.
- **A nested `'__name__'` path segment is NOT special** (probed 2026-07):
  `field("name").as("a.__name__")` succeeds and lands as an ordinary map key —
  `{ a: { __name__: "alice" } }`. Only the top-level output name is reserved.
- **No recovery once dropped**: `select("name") → select("__name__")` yields no
  identity (the first `select` already discarded `__name__`), whereas
  `select("name", "__name__") → select("__name__")` keeps it. The ratchet holds
  only as long as `__name__` is carried through **every** projection.
- `where(...) → select(field("__name__"))` stays identified (where preserves,
  and the `__name__` projection re-attaches the key).

### Implication for the `Pipeline<Schema, Id>` type model

`select` is **not** unconditionally `Id = undefined` at runtime — it preserves
`id`/`ref` iff `__name__` is projected un-aliased. That makes a naive
"`select` → `Id = undefined`" type a **lie** the moment `__name__` is
projectable.

**Chosen resolution (option A — honest by construction):** keep `select`
returning `Id = undefined` unconditionally, and make the lie unrepresentable by
**excluding `"__name__"` from `Selection`** (it uses `MapFieldPath`, the data
fields, not the doc-level `DocFieldPath`). So the only projection that would keep
the key can't be written; identity-preserving reshaping goes through
`addFields` / `removeFields`, and `"__name__"` stays usable in `where` / `sort`
(which don't project).

**Deferred alternative (option B — model it):** preserve `Id` **iff** a
selection's output path is `"__name__"`, generalizing to a row-metadata record
`{ ref; createTime; updateTime }` so `__create_time__` / `__update_time__`
re-attach `createTime` / `updateTime` the same way. This is the faithful model
but needs a timestamp value type (the repo's `Doc<T>` has none) and threading
the record through every stage. See `docs/plan/pipeline-query.md`.

Open / untested (would need a probe to add as table rows):

- Does `aggregate` grouped by `__name__` restore read-identity? The
  `aggregate (with groups)` row above was not grouped by `__name__`; the
  mechanism suggests no (aggregated rows are computed, not document-backed),
  but this is unverified.

## Implications for `firestore-repository`

Model read-identity as a **second type parameter** on a single `Pipeline`
class, rather than splitting into two classes by inheritance. The parameter
carries the identity's _real type_ — a source document ref `DocRef<T>` while
identity is preserved, or `undefined` once it is dropped:

```ts
type PipelineRowIdentity = DocRef<Collection> | undefined;

class Pipeline<Context extends DocumentSchema, Id extends PipelineRowIdentity> {
  // Identity-preserving stages thread `Id` through unchanged.
  where(...):        Pipeline<C,  Id>;
  sort(...):         Pipeline<C,  Id>;
  limit(N):          Pipeline<C,  Id>;
  offset(N):         Pipeline<C,  Id>;
  addFields(...):    Pipeline<C', Id>;
  removeFields(...): Pipeline<C', Id>;
  unnest(...):       Pipeline<C', Id>;

  // Identity-breaking stages reset `Id` to `undefined`.
  select(...):          Pipeline<C', undefined>;
  distinct(...):        Pipeline<C', undefined>;
  aggregate(...):       Pipeline<C', undefined>;
  fullReplaceWith(...): Pipeline<M,  undefined>;
  mergeWith(...):       Pipeline<C', undefined>;

  execute(): Promise<PipelineResult<C, Id>[]>;
}
```

Because the preserving stages thread whatever `Id` they receive and the
breaking stages hard-code `undefined`, identity never returns once dropped —
the ratchet is **structural**, not maintained by hand. (Contrast the
inheritance approach, where forgetting to override a preserving method on the
identified subclass, or accidentally overriding a breaking one, silently
corrupts the ratchet.)

`PipelineResult` exposes `id` only when identified, via a conditional that
mirrors the existing `Doc<T>` shape (`Doc<T> = { id: DocRef<T>; data }`):

```ts
type PipelineResult<Context, Id extends PipelineRowIdentity> = {
  data: FieldValue<MapType<Context>, 'read'>;
} & (Id extends undefined ? unknown : { readonly id: Id });
```

So an identified result is structurally a `Doc<T>`, which makes existing
`Mapper<T, AppModel>` reuse straightforward. Accessing `result.id` after a
`select` becomes a compile-time error rather than a runtime `undefined`.

Sources set the initial `Id`: document-backed sources (`collection` /
`collectionGroup` → `DocRef<T>` —
`collectionGroup` assumes collection names are unique DB-wide so the group
resolves to one collection's type; `database` / `documents` →
`DocRef<Collection>`) start identified; only `literals(...)` starts as
`undefined`.

> Note: `createTime` / `updateTime` are not modeled yet — the repository's
> `Doc<T>` identity collapses to `id: DocRef<T>`. Add them later if needed.
