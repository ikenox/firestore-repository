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

- `pnpm check` - Run all checks (linting with type checking and formatting)
- `pnpm check:lint` - Run oxlint linting with type checking
- `pnpm check:fmt` - Run oxfmt formatting check
- `pnpm fix` - Fix all auto-fixable issues

### Build

- `pnpm build` - Build all packages

## Release

### 1. Pre-release checks

```bash
pnpm check
pnpm test
```

### 2. Bump version numbers

Create a branch, update the `version` field to the same new version in all 3 package files, then open a PR:

```bash
git checkout -b release/vX.Y.Z
```

Files to update:

- `packages/firestore-repository/package.json`
- `packages/google-cloud-firestore/package.json`
- `packages/firebase-js-sdk/package.json`

```bash
git add packages/firestore-repository/package.json packages/google-cloud-firestore/package.json packages/firebase-js-sdk/package.json
git commit -m "vX.Y.Z"
git push origin release/vX.Y.Z
gh pr create --title "vX.Y.Z" --body ""
```

Merge the PR into main before proceeding.

### 3. Trigger GitHub Actions release workflow

Go to **Actions → release → Run workflow**, or use the CLI:

```bash
gh workflow run release.yaml --ref main \
  -f firestore-repository=true \
  -f firebase-js-sdk=true \
  -f google-cloud-firestore=true
```

The workflow will publish selected packages to npm and automatically create a GitHub Release with auto-generated release notes.
