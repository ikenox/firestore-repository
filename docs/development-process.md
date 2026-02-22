# Development Process

## Workflow

Before completing a task, run the following commands to ensure there are no issues:

- `pnpm check` - Static checks (type checking, linting, formatting)
- `pnpm test` - All tests

When making changes to the public API or usage patterns, refer to [coding-guideline.md](./coding-guideline.md#api-changes) for required updates.

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
