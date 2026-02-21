# AGENTS.md

## Overview

Read the following documents to understand the project:

- [docs/project-structure.md](./docs/project-structure.md) - Project structure, package responsibilities, and architectural design philosophy
- [README.md](./README.md) - Project overview and usage examples

## Workflow

Before completing a task, run the following commands to ensure there are no issues:

- `pnpm check` - Static checks (type checking, linting, formatting)
- `pnpm test` - All tests

If your changes affect the public API or usage patterns, update the following as needed:

- `packages/readme-example/` - Test cases that verify README examples work correctly
- `README.md` - Usage examples and documentation

## Available Commands

### Test

- `pnpm test` - Run all tests with coverage
- `pnpm test <path>` - Run tests for specific files (e.g., `pnpm test packages/core`)
- `pnpm test <pattern>` - Run tests matching pattern (e.g., `pnpm test repository`)

### Check / Fix

- `pnpm check` - Run all checks (type checking, linting, and formatting)
- `pnpm check:type` - Run TypeScript type checking (tsgo)
- `pnpm check:lint` - Run oxlint linting
- `pnpm check:fmt` - Run oxfmt formatting check
- `pnpm fix` - Fix all auto-fixable issues

### Build

- `pnpm build` - Build all packages
