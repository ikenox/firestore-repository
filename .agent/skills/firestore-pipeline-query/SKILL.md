---
name: firestore-pipeline-query
description: Background knowledge and official documentation references for Firestore Pipeline Query (Enterprise edition). Use when designing, implementing, or investigating Pipeline API support.
---

# Firestore Pipeline Query Reference

A new query interface introduced in Firestore Enterprise edition. It lets you express filtering, complex AND/OR/IN combinations, aggregation, array unnesting, sub-pipeline joins, vector search, and full-text search as a single pipeline that runs server-side — things the legacy Core query API cannot do (or cannot do cleanly).

The purpose of this skill is to give the agent the prerequisites and a quick-jump index to official references when working on Pipeline Query support inside `firestore-repository`.

## Overview

- **Model**: a chain of stages (input → transformation → optional output) built declaratively, then run with `execute(pipeline)`.
- **Edition requirement**: only works against a Firestore **Enterprise edition** database (not available on Standard).
- **Indexes**: not required (index-optional). Indexes still speed things up; use Query Explain to verify index usage.
- **Execution limits**: **60 seconds** per pipeline, **128 MiB** of materialized data.
- **DML**: appending an `update` / `delete` stage turns a pipeline into a write operation.

## Building blocks

### Input stages (data sources)

| stage                  | purpose                                  |
| ---------------------- | ---------------------------------------- |
| `collection(path)`     | single collection                        |
| `collectionGroup(id)`  | collection group across the database     |
| `database()`           | every document in the database           |
| `documents([...refs])` | a hand-picked set of document references |
| `subcollection(...)`   | a subcollection of a parent doc          |
| `literals([...])`      | synthetic rows from literal values       |

### Transformation stages

Filter / projection: `where`, `select`, `addFields` (`add_fields`), `removeFields`, `replaceWith`

Shape: `sort`, `limit`, `offset`, `distinct`, `sample`, `union`, `unnest`, `let`

Specialized: `aggregate` (with `groups` for grouping), `findNearest` (vector similarity), `search` (full-text)

### Output stages

- `update` / `delete` (Pipeline DML)

### Functions (operating on `field(...)` and expressions)

13 categories: aggregate / arithmetic / array / comparison / debugging / generic / logical / map / reference / string / timestamp / type / vector. Things like `avg`, `min`, `max`, `substring`, `regex_match`, `toUpper`, vector `cosine distance` live here.

### Sub-pipeline (joins)

Embed a nested `db.pipeline()...` inside `select()` or `where()` and surface it via `toArrayExpression()` (array subquery) or `toScalarExpression()` (scalar subquery). The standard pattern is to bind parent-row fields with `let()` and reference them inside the nested pipeline via `variable("name")` — this gives you SQL-style correlated subqueries / joins.

## Minimal example (JS SDK)

```javascript
import { getFirestore, doc } from 'firebase/firestore';
import { execute, field } from 'firebase/firestore/pipelines';

const db = getFirestore(app, 'enterprise');

const pipeline = db
  .pipeline()
  .collection('cities')
  .where(field('population').greaterThan(100000))
  .sort(field('name').ascending())
  .select(field('name'), field('population'))
  .limit(10);

const results = await execute(pipeline);
```

Aggregation with grouping:

```javascript
db.pipeline()
  .collection('books')
  .aggregate(field('rating').average().as('avg_rating'), { groups: [field('genre')] });
```

Getting an Enterprise database handle in other SDKs:

- Swift: `Firestore.firestore(database: "enterprise")`
- Kotlin: `Firebase.firestore("enterprise")`
- Java: `FirebaseFirestore.getInstance("enterprise")`
- Python: `firestore.client(default_app, "<db-id>")`

## Official documentation

### Overview / cross-cutting

- [Get started with pipelines](https://firebase.google.com/docs/firestore/pipelines/get-started-with-pipelines) — entry point; basis for this skill
- [Perform joins with sub-pipelines](https://firebase.google.com/docs/firestore/pipelines/perform-joins-with-sub-pipelines)
- [Pipeline DML (update / delete)](https://firebase.google.com/docs/firestore/pipelines/dml)
- [Regional endpoints](https://firebase.google.com/docs/firestore/pipelines/regional-endpoints)
- [Locations](https://firebase.google.com/docs/firestore/pipelines/locations)
- [Enterprise: text search](https://firebase.google.com/docs/firestore/enterprise/text-search)
- [Enterprise: geospatial query](https://firebase.google.com/docs/firestore/enterprise/geospatial-query)

### Input stages

- [collection](https://firebase.google.com/docs/firestore/pipelines/stages/input/collection)
- [collection-group](https://firebase.google.com/docs/firestore/pipelines/stages/input/collection-group)
- [database](https://firebase.google.com/docs/firestore/pipelines/stages/input/database)
- [documents](https://firebase.google.com/docs/firestore/pipelines/stages/input/documents)
- [literals](https://firebase.google.com/docs/firestore/pipelines/stages/input/literals)
- [subcollection](https://firebase.google.com/docs/firestore/pipelines/stages/input/subcollection)

### Transformation stages

- [add-fields](https://firebase.google.com/docs/firestore/pipelines/stages/transformation/add-fields)
- [aggregate](https://firebase.google.com/docs/firestore/pipelines/stages/transformation/aggregate)
- [distinct](https://firebase.google.com/docs/firestore/pipelines/stages/transformation/distinct)
- [find-nearest](https://firebase.google.com/docs/firestore/pipelines/stages/transformation/find-nearest)
- [let](https://firebase.google.com/docs/firestore/pipelines/stages/transformation/let)
- [limit](https://firebase.google.com/docs/firestore/pipelines/stages/transformation/limit)
- [offset](https://firebase.google.com/docs/firestore/pipelines/stages/transformation/offset)
- [remove-fields](https://firebase.google.com/docs/firestore/pipelines/stages/transformation/remove-fields)
- [replace-with](https://firebase.google.com/docs/firestore/pipelines/stages/transformation/replace-with)
- [sample](https://firebase.google.com/docs/firestore/pipelines/stages/transformation/sample)
- [search](https://firebase.google.com/docs/firestore/pipelines/stages/transformation/search)
- [select](https://firebase.google.com/docs/firestore/pipelines/stages/transformation/select)
- [sort](https://firebase.google.com/docs/firestore/pipelines/stages/transformation/sort)
- [unnest](https://firebase.google.com/docs/firestore/pipelines/stages/transformation/unnest)
- [union](https://firebase.google.com/docs/firestore/pipelines/stages/transformation/union)
- [where](https://firebase.google.com/docs/firestore/pipelines/stages/transformation/where)

### Output stages

- [delete](https://firebase.google.com/docs/firestore/pipelines/stages/output/delete)
- [update](https://firebase.google.com/docs/firestore/pipelines/stages/output/update)

### Functions (expressions / operators)

- [aggregate-functions](https://firebase.google.com/docs/firestore/pipelines/functions/aggregate-functions)
- [arithmetic-functions](https://firebase.google.com/docs/firestore/pipelines/functions/arithmetic-functions)
- [array-functions](https://firebase.google.com/docs/firestore/pipelines/functions/array-functions)
- [comparison-functions](https://firebase.google.com/docs/firestore/pipelines/functions/comparison-functions)
- [debugging-functions](https://firebase.google.com/docs/firestore/pipelines/functions/debugging-functions)
- [generic-functions](https://firebase.google.com/docs/firestore/pipelines/functions/generic-functions)
- [logical-functions](https://firebase.google.com/docs/firestore/pipelines/functions/logical-functions)
- [map-functions](https://firebase.google.com/docs/firestore/pipelines/functions/map-functions)
- [reference-functions](https://firebase.google.com/docs/firestore/pipelines/functions/reference-functions)
- [string-functions](https://firebase.google.com/docs/firestore/pipelines/functions/string-functions)
- [timestamp-functions](https://firebase.google.com/docs/firestore/pipelines/functions/timestamp-functions)
- [type-functions](https://firebase.google.com/docs/firestore/pipelines/functions/type-functions)
- [vector-functions](https://firebase.google.com/docs/firestore/pipelines/functions/vector-functions)

## Empirical gotchas (not in docs)

### `where` is permissive about non-boolean values

The SDK requires a `BooleanExpression` at the TypeScript level, but `Expression.asBoolean()` is a pure type-tag wrap — wire-level the original expression's proto goes through unchanged. So you _can_ push any expression into `where`, e.g. `where(field("flag").asBoolean())` even when `flag` may not be boolean.

Tested behavior: the backend's `where` evaluates the expression per row and **silently drops the row if the result is anything other than `true`** — `false`, `null`, missing field, non-boolean values (number / string / map / etc.) all behave the same as `false`. The whole pipeline does NOT error out even when type mixed docs exist.

Implication: this is JS-`if`-like truthy/falsy semantics, not strict SQL `WHERE`. Mixed-schema collections are tolerated by design.

### `asBoolean()` does not change the wire format

`Expression.asBoolean()` returns a `BooleanExpression` subclass that just stores `this._expr` and delegates `_toProto()`/`_readUserData()` to it. No `is_true` / `cast_bool` / `equal(_, true)` is inserted. It exists purely to satisfy the SDK's TypeScript type signature for `where`.

## How to investigate

1. Read Get started first, then narrow down to the feature you need (aggregation, join, vector, text search, …).
2. Open the per-stage / per-function page for argument shapes, return types, and limits.
3. For exact SDK types and behavior, reading `firebase/firestore/pipelines` (JS) or the `Pipeline`-related exports in `@google-cloud/firestore` directly is usually faster than the docs (the docs describe APIs at a fairly abstract level).
4. If you need details that aren't on the page, WebFetch the specific URL. Append `?hl=ja` for Japanese; the English page sometimes has more content, so it's worth trying both.
