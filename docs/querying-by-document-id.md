# Querying by Document ID (`__name__`)

`__name__` is a reserved field path that refers to a document's identifier. This library exposes
it as a regular field path, so it can be used in `where`, `orderBy`, and cursor constraints just
like any schema field. Its value type is a **`RefPath` segment path** — the full path of the
document as alternating collection names and ids (`['Authors', 'author1']`,
`['Authors', 'author1', 'Posts', '1']`) — the same representation every document reference uses in
this library.

## Convention

The operand is the same `RefPath` **in every query scope** — root collection, subcollection, and
collection group. Build it from a repository-side id with the `refPath` helper, which interleaves
the collection names from the collection definition:

```ts
import { refPath } from 'firestore-repository/path';

// root collection
query({ collection: authors }, where(eq('__name__', refPath(authors, ['author1']))));
query({ collection: authors }, orderBy('__name__', 'asc'));

// subcollection — the address carries the parent id, refPath expands the names
query(
  { collection: posts, parent: ['author1'] },
  where(eq('__name__', refPath(posts, ['author1', '1']))), // ['Authors', 'author1', 'Posts', '1']
);

// collection group — the SAME operand form
query({ collection: posts, group: true }, where(eq('__name__', refPath(posts, ['author1', '1']))));
```

The adapters encode the segment path to a `DocumentReference` value before it reaches the SDK.
This matters because a reference value is the one operand form the raw SDKs accept uniformly; the
SDKs' own _string_ conventions for `__name__` are scope-dependent traps (verified empirically):

|                            | Single collection / subcollection                          | Collection group                                                  |
| -------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| String the raw SDK expects | A **plain document ID** relative to the queried collection | A **fully-qualified document path** relative to the database root |
| Example value              | `'1'`                                                      | `'Authors/author1/Posts/1'`                                       |
| The other form             | ✗ — client-side throw (`contains a slash`)                 | ✗ — client-side throw (`odd number of segments`)                  |
| A `DocumentReference`      | ✓                                                          | ✓                                                                 |

The string forms are client-side conveniences resolved against the query's static scope, compiled
to a reference before hitting the wire; the reference value is the single wire-level concept. By
always sending the reference, this library keeps one operand type across scopes — the invalid
combinations above are simply not expressible.

## What `__name__` returns

`__name__` represents the document identifier (its resource name / path). Typical uses are:

- Filtering by ID (`eq` / `ne` / `inArray`, etc.)
- Ordering by ID (`orderBy('__name__', ...)`)
- Stable pagination cursors (`startAt` / `startAfter` / `endAt` / `endBefore`)

The behavior described here is verified against both SDK implementations
(`@google-cloud/firestore` and `@firebase/firestore`) in the shared specification tests
(`packages/firestore-repository/src/__test__/specification.ts`). Note: cursor constraints
(`startAt` etc.) are currently untyped pass-through, so a `__name__` cursor value must be given in
the form the raw SDK expects.

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
