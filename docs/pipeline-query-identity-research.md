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

| Stage                      | n (results) | id  | ref | createTime | updateTime | Notes                                                                             |
| -------------------------- | ----------- | --- | --- | ---------- | ---------- | --------------------------------------------------------------------------------- |
| `collection()` (baseline)  | 4           | ✓   | ✓   | ✓          | ✓          |                                                                                   |
| `where(...)`               | 2           | ✓   | ✓   | ✓          | ✓          |                                                                                   |
| `sort(...)`                | 4           | ✓   | ✓   | ✓          | ✓          |                                                                                   |
| `limit(N)`                 | 2           | ✓   | ✓   | ✓          | ✓          |                                                                                   |
| `offset(N)`                | 3           | ✓   | ✓   | ✓          | ✓          |                                                                                   |
| `addFields(...)`           | 4           | ✓   | ✓   | ✓          | ✓          | Keeps identity even after deriving new fields.                                    |
| `removeFields(...)`        | 4           | ✓   | ✓   | ✓          | ✓          |                                                                                   |
| `unnest(...)`              | 6           | ✓   | ✓   | ✓          | ✓          | **Same `id` repeated across the rows produced by one source document.**           |
| `select(...)`              | 4           | ✗   | ✗   | ✗          | ✗          | **Drops identity, even for `select("name")` or `select(documentId().as("id"))`.** |
| `distinct(...)`            | 2           | ✗   | ✗   | ✗          | ✗          |                                                                                   |
| `aggregate` (no groups)    | 1           | ✗   | ✗   | ✗          | ✗          |                                                                                   |
| `aggregate` (with groups)  | 2           | ✗   | ✗   | ✗          | ✗          |                                                                                   |
| `replaceWith(...)`         | 4           | ✗   | ✗   | ✗          | ✗          |                                                                                   |
| `where → select`           | 2           | ✗   | ✗   | ✗          | ✗          |                                                                                   |
| `select → where`           | 2           | ✗   | ✗   | ✗          | ✗          |                                                                                   |
| `aggregate → sort → limit` | 2           | ✗   | ✗   | ✗          | ✗          |                                                                                   |

## Summary

- **Identity-preserving stages**: `where`, `sort`, `limit`, `offset`,
  `addFields`, `removeFields`, `unnest`.
- **Identity-breaking stages**: `select`, `distinct`, `aggregate` (with or
  without groups), `replaceWith`.
- **Identity does not recover**: once any identity-breaking stage runs, every
  downstream result is missing `id` / `ref` / `createTime` / `updateTime`. Both
  `where → select` and `select → where` lose identity.

## Surprises vs. naive expectation

- `select` is identity-breaking. A common assumption is "projection still
  maps 1:1 to a source document", but the backend explicitly drops the row's
  key when `select` is applied — even for `select("name")` (no rename, no
  expression) and even when the projection includes
  `documentId(field("__name__")).as("docId")`.
- `addFields` / `removeFields` are identity-preserving. So
  **"keep identity while reshaping fields" should be done via
  `addFields` / `removeFields`, not `select`.**
- `unnest` keeps the source document's id on every emitted row. The same
  `id` therefore appears multiple times when one document has multiple array
  elements — useful for "explode" patterns where you want to know which
  source document each emitted row came from.

## Read-identity (row key) vs. `__name__` field / DML-capability

Two distinct notions are easy to conflate:

- **Read-identity** — whether `PipelineResult.id` / `ref` / `createTime` /
  `updateTime` are populated. This is driven by the result row's
  server-assigned **key** (`e.key?.path`), **not** by any `__name__` _data
  field_. `select` drops the row key even when the projection carries the name
  (tested with `documentId(field("__name__")).as("docId")`), so keeping
  `__name__` as a field does **not** bring read-identity back.
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
`IdentifiedPipeline` / `UnidentifiedPipeline` (read-identity) split.

Open / untested (would need a probe to add as table rows):

- Does `aggregate` grouped by `__name__` restore read-identity? The
  `aggregate (with groups)` row above was not grouped by `__name__`; the
  mechanism suggests no (aggregated rows are computed, not document-backed),
  but this is unverified.
- The table tests `select("name")` and `select(documentId(...).as("docId"))`,
  but not `select("__name__")` (keeping the raw key field) as its own case.

## Implications for `firestore-repository`

Split the pipeline-query type into two classes via inheritance:

- `UnidentifiedPipeline<Context>` — base class. `execute()` returns
  `PipelineResult<Context>` whose `id` / `ref` / `createTime` / `updateTime`
  are absent (or typed `undefined`).
- `IdentifiedPipeline<Context> extends UnidentifiedPipeline<Context>` —
  `execute()` returns a `PipelineResult<Context>` with `id: string` /
  `ref: DocumentReference` / `createTime: Timestamp` / `updateTime: Timestamp`.

Identity-preserving methods are overridden on `IdentifiedPipeline` to narrow
the return type back to `IdentifiedPipeline`. Identity-breaking methods are
not overridden, so they fall through to the base and yield
`UnidentifiedPipeline` — once that happens the chain stays unidentified
(ratchet).

```ts
class UnidentifiedPipeline<C extends DocumentSchema> {
  where(...):       UnidentifiedPipeline<C>;
  sort(...):        UnidentifiedPipeline<C>;
  limit(N):         UnidentifiedPipeline<C>;
  offset(N):        UnidentifiedPipeline<C>;
  addFields(...):   UnidentifiedPipeline<C'>;
  removeFields(...): UnidentifiedPipeline<C'>;
  unnest(...):      UnidentifiedPipeline<C'>;

  select(...):      UnidentifiedPipeline<C'>;
  distinct(...):    UnidentifiedPipeline<C'>;
  aggregate(...):   UnidentifiedPipeline<C'>;
  replaceWith(...): UnidentifiedPipeline<C'>;

  execute(): Promise<UnidentifiedPipelineResult<C>[]>;
}

class IdentifiedPipeline<C extends DocumentSchema> extends UnidentifiedPipeline<C> {
  override where(...):        IdentifiedPipeline<C>;
  override sort(...):         IdentifiedPipeline<C>;
  override limit(N):          IdentifiedPipeline<C>;
  override offset(N):         IdentifiedPipeline<C>;
  override addFields(...):    IdentifiedPipeline<C'>;
  override removeFields(...): IdentifiedPipeline<C'>;
  override unnest(...):       IdentifiedPipeline<C'>;

  // select / distinct / aggregate / replaceWith are NOT overridden — they
  // fall through to the base and return UnidentifiedPipeline.

  override execute(): Promise<IdentifiedPipelineResult<C>[]>;
}
```

`PipelineResult` itself is split the same way:
`IdentifiedPipelineResult<C> extends UnidentifiedPipelineResult<C>` and adds
the four identity fields as non-optional.

The pipeline entry point (`pipelineQuery(collection)`) returns
`IdentifiedPipeline<C>`; only the `literals(...)` source starts as
`UnidentifiedPipeline`.

Accessing `result.id` after a `select` becomes a compile-time error rather
than a runtime `undefined`.
