[![npm version](https://badge.fury.io/js/firestore-repository.svg)](https://badge.fury.io/js/firestore-repository)
[![CI](https://github.com/ikenox/firestore-repository/actions/workflows/check-and-test.yaml/badge.svg)](https://github.com/ikenox/firestore-repository/actions/workflows/check-and-test.yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# firestore-repository

A minimum and universal Firestore ORM (Repository Pattern) for TypeScript

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
````

### For web frontend (with [`@firebase/firestore`](https://www.npmjs.com/package/@firebase/firestore))

```shell
npm install firestore-repository @firestore-repository/firebase-js-sdk
```

## Usage

### Define a collection and its repository

```ts
import { mapTo, data, rootCollection } from 'firestore-repository/schema';

// For backend
import { Firestore } from '@google-cloud/firestore';
import { Repository } from '@firestore-repository/google-cloud-firestore';
const db = new Firestore();

// For web frontend
import { getFirestore } from '@firebase/firestore';
import { Repository } from '@firestore-repository/firebase-js-sdk';
const db = getFirestore();

// define a collection
const users = rootCollection({
  name: 'Users',
  id: mapTo('userId'),
  data: data<{
    name: string;
    profile: {
      age: number;
      gender?: 'male' | 'female';
    };
    tag: string[];
  }>(),
});

const repository = new Repository(users, db);
```

### Basic operations for a single document

```ts
// Set a document
await repository.set({
  userId: 'user1',
  name: 'John Doe',
  profile: {
    age: 42,
    gender: 'male',
  },
  tag: ['new'],
});

// Get a document
const doc = await repository.get({ userId: 'user1' });

// Listen a document
repository.getOnSnapshot({ userId: 'user1' }, (doc) => {
  console.log(doc);
});

// Delete a document
await repository.delete({ userId: 'user2' });
```

### Query

```ts
import { condition as $, limit, query, where } from 'firestore-repository/query';

// Define a query
const query1 = query(users, where($('profile.age', '>=', 20)), limit(10));

// List documents
const docs = await repository.list(query1);
console.log(docs);

// Listen documents
repository.listOnSnapshot(query1, (docs) => {
  console.log(docs);
});

// Aggregate
const result = await repository.aggregate({
  query: query1,
  spec: {
    avgAge: average('profile.age'),
    sumAge: sum('profile.age'),
    count: count(),
  },
});
console.log(`avg:${result.avgAge} sum:${result.sumAge} count:${result.count}`);
```

### Batch operations

```ts
// Get multiple documents (backend only)
const users = await repository.batchGet([{ userId: 'user1' }, { userId: 'user2' }]);

// Set multiple documents
await repository.batchSet([
  {
    userId: 'user1',
    name: 'Alice',
    profile: { age: 30, gender: 'female' },
    tag: ['new'],
  },
  {
    userId: 'user2',
    name: 'Bob',
    profile: { age: 20, gender: 'male' },
    tag: [],
  },
]);

// Delete multiple documents
await repository.batchDelete([{ userId: 'user1' }, { userId: 'user2' }]);
```

#### Include multiple different operations in a batch

```ts
// For backend
const batch = db.writeBatch();
// For web frontend
import { writeBatch } from '@firebase/firestore';
const batch = writeBatch();

await repository.set(
    {
      userId: 'user3',
      name: 'Bob',
      profile: { age: 20, gender: 'male' },
      tag: [],
    },
    { tx: batch },
);
await repository.batchSet([ /* ... */ ], { tx: batch },
);
await repository.delete({ userId: 'user4' }, { tx: batch });
await repository.batchDelete([{ userId: 'user5' }, { userId: 'user6' }], {
  tx: batch,
});

await batch.commit();
```

### Transaction

```ts
// For web frontend
import { runTransaction } from '@firebase/firestore';

// Or, please use db.runTransaction for backend
await runTransaction(async (tx) => {
  // Get
  const doc = await repository.get({ userId: 'user1' }, { tx });
  
  if (doc) {
    doc.tag = [...doc.tag, 'new-tag'];
    // Set
    await repository.set(doc, { tx });
    await repository.batchSet([
      { ...doc, userId: 'user2' },
      { ...doc, userId: 'user3' },
    ], { tx });
  }

  // Delete
  await repository.delete({ userId: 'user4' }, { tx });
  await repository.batchDelete([{ userId: 'user5' }, { userId: 'user6' }], { tx });
});
```

