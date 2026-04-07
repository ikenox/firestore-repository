---
name: npm-release
description: Guide for releasing new versions of firestore-repository packages to npm. Use when the user wants to publish a new version, do a release, bump version, or publish to npm.
---

# npm Release

This project publishes 3 packages. Releases are done via GitHub Actions `workflow_dispatch`, which handles npm publish and GitHub Release creation automatically.

## Packages

- `packages/firestore-repository`
- `packages/google-cloud-firestore`
- `packages/firebase-js-sdk`

## Release Steps

### 1. Pre-release checks

```bash
pnpm check
pnpm test
```

### 2. Bump version via PR

Create a branch, bump versions, and open a PR:

```bash
git checkout -b release/vX.Y.Z
```

Update the `version` field to the same new version in all 3 `package.json` files:

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

```bash
gh workflow run release.yaml --ref main \
  -f firestore-repository=true \
  -f firebase-js-sdk=true \
  -f google-cloud-firestore=true
```

To publish only specific packages, set unwanted ones to `false`.

The workflow will:
- Publish selected packages to npm
- Create a GitHub Release with auto-generated release notes

### 4. Verify

```bash
gh run list --workflow=release.yaml --limit 1
```
