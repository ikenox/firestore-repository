# Querying by Document ID (`__name__`)

`__name__` is a reserved field path that refers to a document's identifier. This library exposes
it as a regular field path (`FieldPath<T>`), so it can be used in `where`, `orderBy`, and cursor
constraints just like any schema field. Its value type is always `string`.

The library passes `__name__` straight through to the underlying Firestore SDK without any special
handling. As a result, the convention for what string to pass is dictated entirely by Firestore,
and — importantly — **it differs depending on the query scope**.

## Convention

|                    | Single collection / subcollection (`parent` given)         | Collection group (`group: true`)                                  |
| ------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| Value to pass      | A **plain document ID** relative to the queried collection | A **fully-qualified document path** relative to the database root |
| Example value      | `'1'`                                                      | `'Authors/author1/Posts/1'`                                       |
| `/` in the value   | Not allowed (must be a plain ID)                           | Required (path separators)                                        |
| Segment count      | 1 (the ID)                                                 | Even (`col/doc/col/doc/...`)                                      |
| Passing a plain ID | ✓                                                          | ✗ — rejected with `odd number of segments`                        |

The reason for the difference: `__name__` values are resolved as a path relative to the query's
scope. A single-collection or subcollection query is already scoped to one concrete collection path
(e.g. `Authors/author1/Posts`), so only the remaining document ID is needed. A collection group
query spans **every** collection of that name across the database (e.g. both `Authors/author1/Posts`
and `Authors/author2/Posts`), so the value must carry the full path from the root to identify a
document unambiguously.

Note that for a subcollection query the parent id is **not** part of the `__name__` value — it is
specified separately via `parent`. Only the leaf document ID goes into `__name__`, and it must not
contain a `/`.

A few additional properties of this contract (verified empirically):

- **Validation is client-side.** An invalid string form throws synchronously in the SDK at query
  construction time (inside `where()`), before any request is sent. The server never sees it.
- **The convention applies to every operator**, not just `eq` — inequality/range filters
  (`gt('__name__', '1')`, etc.) resolve the string the same way, per the query scope.
- **A `DocumentReference` works in every scope** at the SDK level. The string forms are client-side
  conveniences: the SDK resolves the string against the query's static scope and compiles it to a
  reference before it hits the wire. The reference value is the single wire-level concept — which is
  also why Pipeline queries (which have no such scope) accept only references; see below. This
  library's `__name__` contract is the string form; the raw-reference form is not part of its API.

## Single collection / subcollection

Pass a plain document ID. The parent (for a subcollection) is given via `parent`, not in the value.

```ts
// root collection
query({ collection: authors }, where(eq('__name__', '1')));
query({ collection: authors }, orderBy('__name__', 'asc'));

// subcollection — value is the leaf id only ('1'), parent is separate
query({ collection: posts, parent: ['author1'] }, where(eq('__name__', '1')));
query({ collection: posts, parent: ['author1'] }, orderBy('__name__', 'asc'));
```

## Collection group

Pass the fully-qualified document path relative to the database root. The `documentPath` helper
builds this path from a `DocRef`, which keeps the query in sync with your collection definition
(including any parent segments):

```ts
import { documentPath } from 'firestore-repository/path';

query(
  { collection: posts, group: true },
  where(eq('__name__', documentPath(posts, ['author1', '1']))), // 'Authors/author1/Posts/1'
);

query({ collection: posts, group: true }, orderBy('__name__', 'asc'));
```

Passing a plain document ID to a collection group query throws, because a single segment does not
resolve to a valid (even-segment) document path:

```ts
// Throws: "... odd number of segments ..."
query({ collection: posts, group: true }, where(eq('__name__', '1')));
```

## What `__name__` returns

`__name__` represents the document identifier (its resource name / path). Typical uses are:

- Filtering by ID (`eq` / `ne` / `inArray`, etc.)
- Ordering by ID (`orderBy('__name__', ...)`)
- Stable pagination cursors (`startAt` / `startAfter` / `endAt` / `endBefore`)

The behavior described here is verified against both SDK implementations
(`@google-cloud/firestore` and `@firebase/firestore`) in the shared specification tests
(`packages/firestore-repository/src/__test__/specification.ts`).

## Pipeline queries

> The notes below describe the underlying Firestore Pipeline API semantics (an Enterprise-edition
> feature; this library's pipeline support is under development on this branch). They were verified
> empirically against a real Enterprise database, not the emulator (which cannot run pipelines).
> For how this library maps these semantics onto its type system (`DocRefType<'unknown'>`,
> `docRefValue`, `documentId()` / `collectionId()`), see
> [pipeline-query-identity-research.md](./pipeline-query-identity-research.md).

In a Pipeline query the identity semantics change fundamentally: `__name__` is **not a string**, it
is a **`DocumentReference` value**. Unlike classic queries — where `__name__` is a filter-only field
whose value you supply as a string — a pipeline lets you `select` it and derive parts from it with
dedicated functions.

- `select(field('__name__'))` returns a `DocumentReference` (the full path), e.g.
  `Authors/author1/Posts/1`.
- `field('__name__').documentId()` → the leaf id as a **plain string** (`'1'`).
- `field('__name__').collectionId()` → the collection id as a string (`'Posts'`).
- `field('__name__').parent()` → the parent `DocumentReference` (`Authors/author1`).

### Filtering is type-strict

A `__name__` comparison only matches when both sides are the **same type**. A type mismatch yields
zero rows silently (no error), so this is easy to get wrong:

| Filter expression                                                   | Matches |
| ------------------------------------------------------------------- | ------- |
| `field('__name__').equal(db.doc('.../1'))` (DocumentReference)      | ✓       |
| `field('__name__').equal('1')` (string)                             | ✗       |
| `field('__name__').equal('<full path string>')` (string)            | ✗       |
| `field('__name__').documentId().equal('1')` (string vs string)      | ✓       |
| `field('__name__').documentId().equal(db.doc(...))` (string vs ref) | ✗       |

So: compare `__name__` itself against a `DocumentReference` (a string path does **not** work here —
the opposite of classic queries), or compare `documentId()` against a plain string id.

### Collection group

Classic collection group queries require a fully-qualified path string (a plain id is rejected).
Pipelines do not have this asymmetry: `documentId()` extracts the leaf id, so
`collectionGroup(...).where(field('__name__').documentId().equal('1'))` matches by plain id across
all parents — the same expression works for both a single collection and a collection group.
`sort(field('__name__').ascending())` sorts by full path.

### `__path__` is not usable

`__path__` is a reserved name: `select(field('__path__'))` fails with `field name '__path__' is
reserved`, and `parent(field('__path__'))` returns `null`. Perform all identity operations on
`__name__` instead (`parent(field('__name__'))` works as expected).
