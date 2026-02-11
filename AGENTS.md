# AGENTS.md

## Available Commands

- `pnpm test` - Run all tests with coverage
- `pnpm test <path>` - Run tests for specific files (e.g., `pnpm test packages/core`)
- `pnpm test <pattern>` - Run tests matching pattern (e.g., `pnpm test repository`)
- `pnpm check` - Run all checks (type checking, linting, and formatting)
- `pnpm check:type` - Run TypeScript type checking (tsgo)
- `pnpm check:lint` - Run oxlint linting
- `pnpm check:fmt` - Run oxfmt formatting check
- `pnpm fix` - Fix all auto-fixable issues
- `pnpm build` - Build all packages

## Workflow

- When starting work on a new task in a new session, create a git worktree under `.worktree/` and switch to it before making changes. Choose an appropriate worktree/branch name based on the task description.

## Coding Guidelines

- Use `const` instead of `let` for variable declarations
- Always ensure static checks and tests pass before completing any task
