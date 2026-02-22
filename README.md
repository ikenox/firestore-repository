[![npm version](https://badge.fury.io/js/firestore-repository.svg)](https://badge.fury.io/js/firestore-repository)
[![CI](https://github.com/ikenox/firestore-repository/actions/workflows/check-and-test.yaml/badge.svg)](https://github.com/ikenox/firestore-repository/actions/workflows/check-and-test.yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# firestore-repository

A minimal and universal Firestore client (Repository Pattern) for TypeScript

## Features

- 🚀 **Minimal**: Only a few straightforward interfaces and classes. You can start using it immediately without a steep learning curve.
- 🌐 **Universal**: You can share most code, including schema and query definitions, between backend and frontend.
- 🤝 **Unopinionated**: This library does not introduce any additional concepts, and respects the vocabulary of the official Firestore client library.
- ✅ **Type-safe**: This library provides a type-safe interface. It also covers the untyped parts of the official Firestore library.
- 🗄️ **Repository Pattern**: A simple and consistent way to access Firestore data.

## Installation

### For backend (with [`@google-cloud/firestore`](https://www.npmjs.com/package/@google-cloud/firestore))

```shell
npm install firestore-repository @firestore-repository/google-cloud-firestore
```

### For web frontend (with [`@firebase/firestore`](https://www.npmjs.com/package/@firebase/firestore))

```shell
npm install firestore-repository @firestore-repository/firebase-js-sdk
```

## Usage

### Define a collection and its repository

```ts
import { rootCollection, schemaWithoutValidation } from 'firestore-repository/schema';

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
  data: schemaWithoutValidation<{
    name: string;
    profile: { age: number; gender?: 'male' | 'female' };
    tag: string[];
  }>(),
});

const repository = rootCollectionRepository(db, users);
```

### Basic operations for a single document

```ts
// Set a document
await repository.set({
  ref: 'user1',
  data: { name: 'John Doe', profile: { age: 42, gender: 'male' }, tag: ['new'] },
});

// Create a document (backend only)
await repository.create({
  ref: 'user2',
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

### Query

Field paths in query conditions are **automatically derived from the schema type**, not just plain strings — so typos and invalid paths are caught at compile time. The filter value is also **type-checked based on the field type and operator** (e.g., `array-contains` expects an element type of the array field).

```ts
import { eq, gte, limit, query, where } from 'firestore-repository/query';
import { average, count, sum } from 'firestore-repository/aggregate';

// Define a query
// Field paths like 'profile.age' are auto-completed and type-checked against the schema.
// The value `20` is validated as `number` because `profile.age` is `number`.
const q = query(
  { collection: users },
  where(gte('profile.age', 20), eq('profile.gender', 'male')),
  // where(gte('profile.age', 'foo')) // ← Compile error: string is not assignable to number
  // where(eq('nonExistent', 1))      // ← Compile error: invalid field path
  limit(10),
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
  { ref: 'user1', data: { name: 'Alice', profile: { age: 30, gender: 'female' }, tag: ['new'] } },
  { ref: 'user2', data: { name: 'Bob', profile: { age: 20, gender: 'male' }, tag: [] } },
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
  { ref: 'user3', data: { name: 'Bob', profile: { age: 20, gender: 'male' }, tag: [] } },
  { tx: batch },
);
await repository.batchSet(
  [
    /* ... */
  ],
  { tx: batch },
);
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
        { ...doc, ref: 'user2' },
        { ...doc, ref: 'user3' },
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

Subcollections are defined with `subCollection`, specifying the parent collection path. The only difference from root collections is that the document ref becomes a tuple (array of parent doc ID + doc ID). All other operations (query, batch, transaction, etc.) work the same.

```ts
import { subCollection, schemaWithoutValidation } from 'firestore-repository/schema';

// For backend
import { subcollectionRepository } from '@firestore-repository/google-cloud-firestore';

// For web frontend
import { subcollectionRepository } from '@firestore-repository/firebase-js-sdk';

const posts = subCollection({
  name: 'Posts',
  data: schemaWithoutValidation<{ title: string }>(),
  parent: ['Users'] as const,
});

const postRepository = subcollectionRepository(db, posts);

// Set a document (ref is [parentDocId, docId])
await postRepository.set({ ref: ['user1', 'post1'], data: { title: 'My first post' } });

// Get a document
const post = await postRepository.get(['user1', 'post1']);
```

### Custom Mapper

By default, `rootCollectionRepository` returns a repository with `{ ref: string, data: ... }` as its model type. If you want to use your own application model types, you can define a custom `Mapper` and use `repositoryWithMapper` to create a repository that automatically converts between Firestore documents and your models.

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
  fromFirestore: (doc) => ({ id: doc.ref[0], ...doc.data }),
  toFirestore: (user) => ({
    ref: [user.id],
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
