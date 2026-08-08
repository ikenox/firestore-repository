[![npm version](https://badge.fury.io/js/firestore-repository.svg)](https://badge.fury.io/js/firestore-repository)
[![CI](https://github.com/ikenox/firestore-repository/actions/workflows/ci.yaml/badge.svg)](https://github.com/ikenox/firestore-repository/actions/workflows/ci.yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# firestore-repository

A minimal, universal Firestore client for TypeScript, built around the Repository Pattern.

> [!NOTE]
> **New in v0.6.0:** [Pipeline operations](https://docs.cloud.google.com/firestore/native/docs/pipeline/overview) support (Firestore Enterprise) — build type-safe, multi-stage pipelines (`where` / `sort` / `select` / `aggregate` / `distinct` / `unnest` / `replaceWith` / ...) whose result shape is derived from your schema. See the [Pipeline operations](#pipeline-operations) section for details.

## Features

- 🚀 **Minimal**: Only a few straightforward interfaces and classes. You can start using it immediately without a steep learning curve.
- 🌐 **Universal**: You can share most code, including schema and query definitions, between backend and frontend.
- 🤝 **Unopinionated**: This library introduces no additional concepts and follows the vocabulary of the official Firestore client libraries.
- ✅ **Type-safe**: This library provides a type-safe interface. It also covers the untyped parts of the official Firestore library.
- 🗄️ **Repository Pattern**: A simple and consistent way to access Firestore data.
- 🧩 **[Pipeline operations](#pipeline-operations)**: Build advanced, multi-stage queries (Firestore Enterprise) with the same type-safety — field paths, stage inputs, and the shape of the result rows are all derived from your schema.

## Installation

The Firestore SDKs (`@google-cloud/firestore` / `@firebase/firestore`) are declared as peer
dependencies, so install the one for your environment alongside this library.

### For backend (with [`@google-cloud/firestore`](https://www.npmjs.com/package/@google-cloud/firestore))

```shell
npm install firestore-repository @firestore-repository/google-cloud-firestore @google-cloud/firestore
```

### For web frontend (with [`@firebase/firestore`](https://www.npmjs.com/package/@firebase/firestore))

```shell
npm install firestore-repository @firestore-repository/firebase-js-sdk @firebase/firestore
```

## Usage

### Define a collection and its repository

```ts
import {
  rootCollection,
  string,
  double,
  map,
  optional,
  literal,
  array,
} from 'firestore-repository/schema';

// For backend
import { Firestore } from '@google-cloud/firestore';
import { rootCollectionRepository } from '@firestore-repository/google-cloud-firestore';
const db = new Firestore();

// For web frontend
import { getFirestore } from '@firebase/firestore';
import { rootCollectionRepository } from '@firestore-repository/firebase-js-sdk';
const db = getFirestore();

// define a collection
const users = rootCollection({
  name: 'Users',
  schema: {
    name: string(),
    profile: map({ age: double(), gender: optional(literal('male', 'female')) }),
    tag: array(string()),
  },
});

const repository = rootCollectionRepository(db, users);
```

### Basic operations for a single document

All operations are **type-safe** based on the schema you defined. The `data` field is typed according to your schema, so invalid data is caught at compile time.

```ts
// Set a document
await repository.set({
  id: 'user1',
  data: { name: 'John Doe', profile: { age: 42, gender: 'male' }, tag: ['new'] },
});

// Create a document (backend only)
await repository.create({
  id: 'user2',
  data: { name: 'Charlie', profile: { age: 25, gender: 'male' }, tag: [] },
});

// Get a document
const doc = await repository.get('user1');

// Listen to a document
repository.getOnSnapshot('user1', (doc) => {
  console.log(doc);
});

// Delete a document
await repository.delete('user2');
```

> [!NOTE]
> `getOnSnapshot` and `listOnSnapshot` take an optional third argument, an `error`
> callback. It receives a stream failure **and** a document that does not decode
> against your schema, and either one ends the subscription — subscribe again to
> recover. Without that callback the failure is rethrown asynchronously, so it is
> never silently dropped.

### Query

Field paths in query conditions are **automatically derived from the schema type**, not just plain strings — so typos and invalid paths are caught at compile time. The filter value is also **type-checked based on the field type and operator** (e.g., `array-contains` expects the element type of the array field).

```ts
import { collection, eq, gte, limit, query, where } from 'firestore-repository/query';
import { average, count, sum } from 'firestore-repository/aggregate';
// Backend only: @firebase/firestore does not support offset constraints.
import { offset } from '@firestore-repository/google-cloud-firestore/query';

// Define a query
// Field paths like 'profile.age' are auto-completed and type-checked against the schema.
// The value `20` is validated as `number` because `profile.age` is `number`.
const q = query(
  collection(users),
  where(gte('profile.age', 20), eq('profile.gender', 'male')),
  // where(gte('profile.age', 'foo')) // ← Compile error: string is not assignable to number
  // where(eq('nonExistent', 1))      // ← Compile error: invalid field path
  limit(10),
  offset(5),
);

// List documents
const docs = await repository.list(q);

// Listen to documents
repository.listOnSnapshot(q, (docs) => {
  console.log(docs);
});

// Aggregate
const result = await repository.aggregate(q, {
  avgAge: average('profile.age'),
  sumAge: sum('profile.age'),
  count: count(),
});
console.log(`avg:${result.avgAge} sum:${result.sumAge} count:${result.count}`);
```

### Batch operations

```ts
// Get multiple documents (backend only)
const users = await repository.batchGet(['user1', 'user2']);

// Set multiple documents
await repository.batchSet([
  { id: 'user1', data: { name: 'Alice', profile: { age: 30, gender: 'female' }, tag: ['new'] } },
  { id: 'user2', data: { name: 'Bob', profile: { age: 20, gender: 'male' }, tag: [] } },
]);

// Delete multiple documents
await repository.batchDelete(['user1', 'user2']);
```

#### Include multiple different operations in a batch

```ts
// For backend
const batch = db.batch();
// For web frontend
import { writeBatch } from '@firebase/firestore';
const batch = writeBatch(db);

await repository.set(
  { id: 'user3', data: { name: 'Bob', profile: { age: 20, gender: 'male' }, tag: [] } },
  { tx: batch },
);
await repository.batchSet([/* ... */], { tx: batch });
await repository.delete('user4', { tx: batch });
await repository.batchDelete(['user5', 'user6'], { tx: batch });

await batch.commit();
```

### Transaction

```ts
// For web frontend
import { runTransaction } from '@firebase/firestore';

// Or use db.runTransaction for backend
await runTransaction(db, async (tx) => {
  // Get
  const doc = await repository.get('user1', { tx });

  if (doc) {
    doc.data.tag = [...doc.data.tag, 'new-tag'];
    // Set
    await repository.set(doc, { tx });
    await repository.batchSet(
      [
        { ...doc, id: 'user2' },
        { ...doc, id: 'user3' },
      ],
      { tx },
    );
  }

  // Delete
  await repository.delete('user4', { tx });
  await repository.batchDelete(['user5', 'user6'], { tx });
});
```

### Subcollection

Subcollections are defined with `subCollection`, specifying the parent collection path. The only difference from root collections is that the document ref becomes a tuple (`[parentDocId, docId]`) instead of a plain string. All other operations (query, batch, transaction, etc.) work the same.

```ts
import { subCollection, string } from 'firestore-repository/schema';

// For backend
import { subcollectionRepository } from '@firestore-repository/google-cloud-firestore';

// For web frontend
import { subcollectionRepository } from '@firestore-repository/firebase-js-sdk';

const posts = subCollection({
  name: 'Posts',
  schema: { title: string() },
  parent: ['Users'] as const,
});

const postRepository = subcollectionRepository(db, posts);

// Set a document (id is [parentDocId, docId])
await postRepository.set({ id: ['user1', 'post1'], data: { title: 'My first post' } });

// Get a document
const post = await postRepository.get(['user1', 'post1']);
```

### Custom Mapper

By default, `rootCollectionRepository` returns a repository with `{ id: string, data: ... }` as its model type. If you want to use your own application model types, you can define a custom `Mapper` and use `repositoryWithMapper` to create a repository that automatically converts between Firestore documents and your models.

A `Mapper` consists of three functions:

- `toDocRef`: Converts your model's ID to a Firestore document reference
- `fromFirestore`: Converts a Firestore document to your read model
- `toFirestore`: Converts your write model to a Firestore document

You can also define different types for reading and writing via `AppModel<Id, Read, Write>` (e.g., omitting server-managed fields from the write type).

```ts
import { type AppModel, type Mapper } from 'firestore-repository/repository';

// For backend
import { repositoryWithMapper } from '@firestore-repository/google-cloud-firestore';
// For web frontend
import { repositoryWithMapper } from '@firestore-repository/firebase-js-sdk';

// Define your application model type
type User = {
  id: string;
  name: string;
  profile: { age: number; gender?: 'male' | 'female' };
  tag: string[];
};

// Define a mapper
const userMapper: Mapper<typeof users, AppModel<string, User, User>> = {
  toDocRef: (id) => [id],
  fromFirestore: (doc) => ({ id: doc.id[0], ...doc.data }),
  toFirestore: (user) => ({
    id: [user.id],
    data: { name: user.name, profile: user.profile, tag: user.tag },
  }),
};

const repository = repositoryWithMapper(db, users, userMapper);

// Now the repository accepts and returns your custom User type directly
await repository.set({
  id: 'user1',
  name: 'Alice',
  profile: { age: 30, gender: 'female' },
  tag: ['new'],
});
const user: User | undefined = await repository.get('user1');
await repository.delete('user1');
```

### Pipeline operations

> **Note:** [Pipeline operations](https://docs.cloud.google.com/firestore/native/docs/pipeline/overview) require a Firestore **Enterprise** database. They are not available on Standard databases or the emulator.

A pipeline expresses a query as a chain of stages (`where`, `sort`, `select`, `aggregate`, `distinct`, `unnest`, `replaceWith`, `search`, ...) that reshape the rows one stage at a time — far more expressive than a single `query(...)`.

Pipelines follow the same **type-safe** philosophy as the rest of the library: the schema flows through every stage, so field paths, aggregate inputs, and the shape of the result rows are all derived from the schema and checked at compile time. A stage that reshapes the rows (e.g. `select` / `aggregate`) reshapes the result type to match.

```ts
import { collection } from 'firestore-repository/pipelines/source';
import { average, countAll, greaterThanOrEqual } from 'firestore-repository/pipelines/expression';

// For backend
import { executor } from '@firestore-repository/google-cloud-firestore/pipeline';
// For web frontend
import { executor } from '@firestore-repository/firebase-js-sdk/pipeline';

const pipe = executor(db);

// Build a multi-stage pipeline. `field(...)` paths are auto-completed and
// type-checked against the schema, and `20` is validated as `number` because
// `profile.age` is `number`.
const pipeline = collection(users)
  .where((field) => greaterThanOrEqual(field('profile.age'), 20))
  .aggregate((field) => ({
    groups: [field('profile.gender').as('gender')],
    accumulators: [average(field('profile.age')).as('avgAge'), countAll().as('count')],
  }));

// Execute it. The result type is derived from the pipeline's final shape:
//   { data: { gender: 'male' | 'female' | null; avgAge: number | null; count: number } }[]
const rows = await pipe.execute(pipeline);
```

#### Applying a mapper to the results

A result row carries `id` only while the pipeline preserves **read-identity** — that is, while every stage keeps each row tied to the source document it came from. Such a row is structurally the same `{ id, data }` shape as a repository document, so the [custom mapper](#custom-mapper) you already wrote for the collection can convert pipeline results into your application model, with no pipeline-specific mapper needed.

```ts
import { asc } from 'firestore-repository/pipelines/ordering';

const identified = await pipe.execute(
  collection(users)
    .where((field) => greaterThanOrEqual(field('profile.age'), 20))
    .sort((field) => [asc(field('name'))])
    .limit(10),
);

// Reuses the `userMapper` defined in "Custom Mapper" above
const found: User[] = identified.map(userMapper.fromFirestore);
```

Stages that reshape a row into something that is no longer a source document — `select`, `aggregate`, `distinct`, `replaceWith` — drop read-identity, and the result rows then have no `id` at all. Passing those to a mapper is a **compile-time error** rather than a runtime surprise:

```ts
const projected = await pipe.execute(collection(users).select((field) => [field('name')]));
// @ts-expect-error `select` dropped read-identity, so the rows have no `id`
projected.map(userMapper.fromFirestore);
```
