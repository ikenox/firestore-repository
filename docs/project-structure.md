# Project Structure

This document describes the structure of the firestore-repository project, the responsibilities of each package, and the architectural design philosophy.

## Overview

firestore-repository is a monorepo project that provides a minimal and universal Firestore client (Repository Pattern) for TypeScript.

## Directory Structure

```
firestore-repository/
├── packages/                      # npm packages
│   ├── firestore-repository/      # Core package (platform-agnostic)
│   ├── google-cloud-firestore/    # Backend implementation
│   ├── firebase-js-sdk/           # Frontend implementation
│   └── readme-example/            # Test code for README examples
├── firebase-emulator/             # Firebase Emulator configuration
├── docs/                          # Project documentation
└── .worktree/                     # git worktree working directories
```

## Package Responsibilities

### 1. `firestore-repository` (Core Package)

**Role**: Provides platform-agnostic schema definitions, query building, and repository pattern abstractions for Firestore

**Responsibilities**:

- Schema definition (`schema.ts`)
  - Schema definitions for collections and subcollections
  - Type-safe data model definitions
- Query building (`query.ts`)
  - Type-safe query builder
  - Auto-completion and type checking for field paths
- Document operations (`document.ts`)
  - Abstraction of basic document operations
- Repository interface (`repository.ts`)
  - Interface definitions for CRUD operations
  - Support for batch operations and transactions
- Aggregate operations (`aggregate.ts`)
  - Aggregation functions like count, sum, average
- Path operations (`path.ts`)
  - Operations for collection and document paths

**Export Structure**:

- Main export: `index.ts`
- Subpath exports: `schema`, `query`, `aggregate`, `repository`, etc.

**Dependencies**:

- No external dependencies (achieving platform independence)

### 2. `@firestore-repository/google-cloud-firestore`

**Role**: Backend (Node.js) implementation of the core package

**Responsibilities**:

- Repository implementation using `@google-cloud/firestore`
- Support for server-side specific features (`create`, `batchGet`, etc.)
- Concrete implementation of Firestore operations for backend environments

**Main Exports**:

- `rootCollectionRepository`: Repository factory for root collections
- `subcollectionRepository`: Repository factory for subcollections
- `repositoryWithMapper`: Repository factory with custom mapper support

**Dependencies**:

- `@google-cloud/firestore`: Google Cloud Firestore SDK
- `firestore-repository`: Core package (workspace dependency)

### 3. `@firestore-repository/firebase-js-sdk`

**Role**: Frontend (browser) implementation of the core package

**Responsibilities**:

- Repository implementation using `@firebase/firestore`
- Concrete implementation of Firestore operations for client-side environments
- Support for real-time listeners (`onSnapshot`)

**Main Exports**:

- `rootCollectionRepository`: Repository factory for root collections
- `subcollectionRepository`: Repository factory for subcollections
- `repositoryWithMapper`: Repository factory with custom mapper support

**Dependencies**:

- `@firebase/firestore`: Firebase JavaScript SDK
- `firestore-repository`: Core package (workspace dependency)

### 4. `readme-example`

**Role**: Verify that code examples in README actually work

**Responsibilities**:

- Test cases for code examples in README
- Verification of public API usage examples
- Maintaining consistency between documentation and code

## Architectural Design Philosophy

### 1. Repository Pattern

- Abstract Firestore access using the repository pattern
- Separation of business logic and data access layer
- Improved testability

### 2. Universal (Platform-Agnostic)

**3-Layer Architecture**:

```
┌─────────────────────────────────────┐
│  Application Code (User Code)       │
├─────────────────────────────────────┤
│  Core Package (Abstraction Layer)   │
│  - Schema definitions                │
│  - Query builder                     │
│  - Repository interface              │
├─────────────────────────────────────┤
│  Platform-specific Implementation   │
│  - google-cloud-firestore            │
│  - firebase-js-sdk                   │
├─────────────────────────────────────┤
│  Firestore SDK                       │
│  - @google-cloud/firestore           │
│  - @firebase/firestore               │
└─────────────────────────────────────┘
```

**Benefits**:

- Schema and query definitions can be shared between backend and frontend
- Hides platform-specific implementations
- Improved code reusability

### 3. Type Safety

- Maximize use of TypeScript's type system
- Consistent type inference from schema to query
- Auto-completion and type checking for field paths
- Cover untyped parts of the official SDK

**Type Safety Example**:

```typescript
// Types are inferred from schema
const users = rootCollection({
  name: 'Users',
  data: schemaWithoutValidation<{ name: string; profile: { age: number } }>(),
});

// Field path 'profile.age' is type-checked
query(
  { collection: users },
  $('profile.age', '>=', 20), // OK
  $('profile.age', '>=', 'foo'), // Compile error
  $('nonExistent', '==', 1), // Compile error
);
```

### 4. Minimal & Unopinionated

- Provide only the minimum necessary interfaces and classes
- Respect the official Firestore terminology
- Do not introduce additional concepts
- Minimize learning curve

### 5. Extensibility

**Custom Mapper Pattern**:

- Support for converting from the default document model (`{ ref, data }`) to custom application models
- `repositoryWithMapper` enables flexible model conversion
- Can define different types for read and write operations

## Code Placement Guidelines

### Where to Add New Features

1. **Platform-agnostic features**
   - → Add to `packages/firestore-repository/src/`
   - Examples: New query operators, schema definition features

2. **Backend-specific features**
   - → Add to `packages/google-cloud-firestore/src/`
   - Examples: Server-specific Firestore features

3. **Frontend-specific features**
   - → Add to `packages/firebase-js-sdk/src/`
   - Examples: Client-specific Firestore features

4. **Usage examples and documentation**
   - README updates: `README.md` in project root
   - Test case additions: `packages/readme-example/src/`

### File Naming Conventions

- Implementation files: `*.ts`
- Test files: `*.test.ts`
- Type definitions: Types are defined within each implementation file (not in separate files)

## Development Workflow

### Branch Strategy

- Main branch: `main`
- Working branches: Use git worktree (under `.worktree/`)
- Direct commits to default branch are prohibited

### Testing and Checks

Always run the following after making changes:

```bash
pnpm check  # Type checking, linting, formatting check
pnpm test   # Run all tests
```

### Public API Changes

The following updates are required:

1. `README.md`: Update usage examples
2. `packages/readme-example/`: Add test cases

## Monorepo Management

- Package manager: pnpm (using workspace feature)
- Build tool: TypeScript (tsc)
- Test framework: Vitest
- Lint/Format: oxlint, oxfmt
- Type checking: tsgo (TypeScript native preview)

### Workspace Dependencies

```
    firestore-repository (core)
        ↑           ↑
        |           |
        |           |
google-cloud    firebase-js-sdk
-firestore      (implementation)
(implementation)
        ↑           ↑
        |           |
        +-----+-----+
              |
        readme-example
          (tests)
```

- `readme-example` depends on both `google-cloud-firestore` and `firebase-js-sdk` (and the core package) to test examples for both backend and frontend environments
- Package dependencies are managed using the `workspace:*` protocol
