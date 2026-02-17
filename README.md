[![npm version](https://badge.fury.io/js/firestore-repository.svg)](https://badge.fury.io/js/firestore-repository)
[![CI](https://github.com/ikenox/firestore-repository/actions/workflows/check-and-test.yaml/badge.svg)](https://github.com/ikenox/firestore-repository/actions/workflows/check-and-test.yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# firestore-repository

A minimum and universal Firestore client (Repository Pattern) for TypeScript

## Features

- 🚀 **Minimum**: Only a few straightforward interfaces and classes. You can easily start to use it immediately without learning a lot of things.
- 🌐 **Universal**: You can share most code, including schema and query definitions, between backend and frontend.
- 🤝 **Unopinionated**: This library does not introduce any additional concepts, and respects vocabulary of the official Firestore client library.
- ✅ **Type-safe**: This library provides the type-safe interface. It also covers the untyped parts of the official Firestore library.
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
import { newRootCollectionRepository } from '@firestore-repository/google-cloud-firestore';
const db = new Firestore();

// For web frontend
import { getFirestore } from '@firebase/firestore';
import { newRootCollectionRepository } from '@firestore-repository/firebase-js-sdk';
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

const repository = newRootCollectionRepository(db, users);
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

// Listen a document
repository.getOnSnapshot('user1', (doc) => {
  console.log(doc);
});

// Delete a document
await repository.delete('user2');
```

### Query

```ts
import { condition as $, limit, query } from 'firestore-repository/query';
import { average, count, sum } from 'firestore-repository/aggregate';

// Define a query
const q = query(
  { collection: users },
  $('profile.age', '>=', 20),
  $('profile.gender', '==', 'male'),
  limit(10),
);

// List documents
const docs = await repository.list(q);

// Listen documents
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

// Or, please use db.runTransaction for backend
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
