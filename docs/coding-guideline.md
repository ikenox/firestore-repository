# Coding Guidelines

## Documentation

- All functions and type definitions MUST include JSDoc comments describing their purpose, role, and any notable details
- Add explanatory comments to object and class field definitions when necessary

## Code Style

Follow the project's linting and formatting rules enforced by `pnpm check`.

## Declaration order

- Order declarations within a file **top-down by abstraction level** (the
  "stepdown rule"): the most **integrative / high-level** concept — typically
  the file's main exported class / function — comes **first**, and the
  lower-level details it builds on follow **below** it. A reader meets the
  headline concept first, then drills down into the supporting pieces.
- Keep the same direction among the supporting declarations: more integrative
  above, more primitive / foundational below.
- Example (`pipelines/pipeline.ts`): `Pipeline` (the API) → `PipelineResult`
  (its output) → `FieldProvider` → `PipelineRowIdentity` → `MergeMode` →
  `unimplemented` (stub helper) → `Fields` (the base schema alias).

## API Changes

When your changes affect the public API or usage patterns, you MUST update the following:

- `packages/readme-example/` - Test cases that verify README examples work correctly
- `README.md` - Usage examples and documentation

This ensures that:

- All public API changes are verified through executable examples
- Documentation stays in sync with actual implementation
- Breaking changes are caught early through failing example tests
