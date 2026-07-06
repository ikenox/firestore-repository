# Coding Guidelines

## Documentation

- All functions and type definitions MUST include JSDoc comments describing their purpose, role, and any notable details
- Add explanatory comments to object and class field definitions when necessary

## Code Style

Follow the project's linting and formatting rules enforced by `pnpm check`.

## Type assertions

- **Do not use type assertions (`as`, `as unknown as`, non-null `!`).** They are
  banned except when it is **theoretically impossible** to make the types line up
  otherwise — i.e. a genuine TypeScript limitation, not merely inconvenient
  typing. Before reaching for an assertion, restructure the code (generics,
  narrowing, helper types) so the types check on their own.
- A legitimate case is bridging an unavoidably-`unknown`/runtime value to a type
  the compiler cannot statically prove (e.g. a value decoded from Firestore back
  into a schema-derived type, or a phantom `input`/`output` field that exists
  only at the type level). Prefer to isolate such an assertion to the single
  narrowest spot (e.g. the returned value), not a whole function or object.
- Every remaining assertion MUST carry an `oxlint-disable-next-line
typescript/no-unsafe-type-assertion` comment stating the specific compiler
  limitation that makes it unavoidable.

## Union / enum-like value handling

- **Always handle union-typed (or enum-like literal) values with an exhaustive
  `switch`.** Enumerate every member explicitly — including the ones you don't
  support yet (make those `case`s throw an "unsupported" error). Adding a new
  member to the union must surface every handling site as a compile/lint error,
  never fall through silently.
- **The `default` clause may contain nothing but `assertNever(...)`** (from
  `firestore-repository/util`). Never use `default` as a catch-all for "the
  rest of the members"; a non-exhaustive `switch` is forbidden.
- **Do not branch on union/enum-like values with `if` / ternary equality
  comparisons** (e.g. `if (x.kind !== 'field')`, `dir === 'asc' ? a : b`).
  Use an exhaustive `switch` instead. Comparisons that are not union-member
  discrimination (e.g. `=== undefined` on an optional, numeric comparisons)
  are fine.
- Enforcement: `typescript/switch-exhaustiveness-check` (with
  `considerDefaultExhaustiveForUnions: false`, `requireDefaultForNonUnion: true`)
  in `.oxlintrc.json` enforces the `switch` rules. The `if`/ternary ban is
  enforceable in principle (a type-aware rule could detect union-typed
  operands), but no existing rule implements it — typescript-eslint has none,
  oxlint's type-aware set (tsgolint) only ports existing typescript-eslint
  rules, and oxlint's custom JS plugins don't expose type information. Until
  such a rule exists, it is upheld by review.

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
