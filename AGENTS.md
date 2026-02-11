# AGENTS.md

## Workflow

**IMPORTANT: Before making ANY file changes, you MUST complete step 1. No exceptions, even for small or single-file changes.**

1. Create a branch and worktree: fetch the latest remote default branch (`git fetch origin main`), then create a new branch from `origin/main` and a git worktree for it under `.worktree/`, and `cd` into it so that all subsequent commands run inside the worktree. Choose an appropriate branch/worktree name based on the task description. Do not commit directly to main. Unless the user explicitly instructs otherwise (e.g., working on an existing branch, or skipping worktree creation), always follow this step.
2. Make your changes in the worktree.
3. Before completing a task, run `pnpm check` to ensure static checks (type checking, linting, formatting) pass.
4. Before completing a task, run `pnpm test` to ensure all tests pass.

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
