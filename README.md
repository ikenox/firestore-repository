[![npm version](https://badge.fury.io/js/firestore-repository.svg)](https://badge.fury.io/js/firestore-repository)
[![CI](https://github.com/ikenox/firestore-repository/actions/workflows/check-and-test.yaml/badge.svg)](https://github.com/ikenox/firestore-repository/actions/workflows/check-and-test.yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# firestore-repository

A minimum and universal Firestore ORM (Repository Pattern) for TypeScript

## Features

- 🚀 **Minimum**: Only a few straightforward interfaces and classes. You can easily start to use it immediately without learning a lot of things.
- 🌐 **Unopinionated**: This library does not introduce any additional concepts, and respects an interface of the official Firestore client library.
- ✅ **Type-safe**: This library provides the type-safe interface. It also covers the untyped parts of the official Firestore library.
- 🗄️ **Repository Pattern**: A simple and consistent way to access Firestore data.

## Installation

### For backend (with `@google-cloud/firestore` or `firebase-admin`)

```shell
npm install firestore-repository @firestore-repository/google-cloud-firestore 
````

### For web frontend (with `firebase-js-sdk`)

```shell
npm install firestore-repository @firestore-repository/firebase-js-sdk
```

## Basic usage

```ts
import { id, implicit, rootCollection } from 'firestore-repository/schema';
import { condition as $, limit, query, where } from 'firestore-repository/query';

// For backend
import { Firestore } from '@google-cloud/firestore';
import { Repository } from '@firestore-repository/google-cloud-firestore';
const db = new Firestore();
const repository = new Repository(authors, db);

// For web frontend
import { getFirestore } from '@firebase/firestore';
import { Repository } from '@firestore-repository/firebase-js-sdk';
const db = getFirestore();
const repository = new Repository(authors, db);

// define a collection
const authors = rootCollection({
  name: 'Authors',
  id: id('authorId'),
  data: implicit(
    (data: {
      name: string;
      profile: {
        age: number;
        gender?: 'male' | 'female';
      };
      tag: string[];
      registeredAt: Timestamp;
    }) => ({
      ...data,
      registeredAt: data.registeredAt.toDate(),
    }),
  ),
});

// set
await repository.set({
  authorId: 'author1',
  name: 'John Doe',
  profile: {
    age: 42,
    gender: 'male',
  },
  tag: ['new'],
  registeredAt: new Date(),
});

// get
const doc = await repository.get({ authorId: 'author1' });
console.info(doc);

// query snapshot
const q1 = query(authors, where($('profile.age', '>=', 20)), limit(10));
const docs = await repository.list(q1);
console.log(docs);

// listen query
const q2 = query(authors, where($('tag', 'array-contains', 'new')), limit(10));
repository.listOnSnapshot(q2, (docs) => { console.log(docs); });
```
