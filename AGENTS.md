# AGENTS.md

## Available Commands

- `pnpm test` - Run all tests with coverage
- `pnpm test <path>` - Run tests for specific files (e.g., `pnpm test packages/core`)
- `pnpm test <pattern>` - Run tests matching pattern (e.g., `pnpm test repository`)
- `pnpm check` - Run all checks (type checking and linting)
- `pnpm check:type` - Run TypeScript type checking
- `pnpm check:biome` - Run Biome linting and formatting checks
- `pnpm fix` - Fix all auto-fixable issues
- `pnpm build` - Build all packages

## Coding Guidelines

- Use `const` instead of `let` for variable declarations
- Always ensure static checks and tests pass before completing any task
