# Coding Guidelines

## Documentation

- All functions and type definitions MUST include JSDoc comments describing their purpose, role, and any notable details
- Add explanatory comments to object and class field definitions when necessary
- **Record non-obvious design decisions (the WHY) — and route them by
  audience.** A rationale that affects how the API is USED (why a value is
  represented this way, why an input is rejected, why two similar-looking
  types are distinct — e.g. why a reference VALUE (`RefPath`) carries its
  collection names while the repository's `DocRef` address does not) belongs
  in the **JSDoc**, where a
  consumer hovering the symbol sees it. A rationale that only matters to
  maintainers (compiler workarounds, why an implementation shape was chosen
  over an alternative, probe references) stays a **plain comment** inside the
  implementation. The test: "would a user of this API make a wrong decision
  without knowing this?" — yes → JSDoc, no → plain comment.

## Code Style

Follow the project's linting and formatting rules enforced by `pnpm check`.

## Design principles

- **Systemic consistency is the top priority — no ad-hoc special cases.** A
  new capability must be an instance of an existing rule of the system (or a
  deliberate, documented extension of one), not a one-off carve-out.
  Precedent: values without an unambiguous plain-JS representation get
  dedicated expression nodes — `geoPointValue`, `vectorValue`, and later
  `docRefValue` all follow the ONE classification rule rather than each
  getting bespoke treatment. When a proposal only works for the case at hand,
  find the rule it should be an instance of first.
- **Deferring parts is fine; deviating structures is not.** Implementation
  cost may postpone a piece of the system (an unimplemented function family,
  a not-yet-supported descriptor), but what IS built must always have the
  same fundamental structure as the intended end state. Building something
  "for now" on a structure that the final design will have to replace is not
  acceptable — a missing limb is recoverable, a wrong skeleton is not.
  Likewise, do not dismiss a consistent-but-rare case as "low practical
  utility"; uniformity of the system is itself the utility.
- **Always-valid domain model ("parse, don't validate").** A value carrying a
  precise type must be valid by construction — holding a `RefPath<Posts>`
  means the segment path IS a Posts path, no re-checking downstream. Two
  corollaries:
  - Data of uncertain validity (untyped/context-free values, wire data)
    enters the typed world only through a dedicated **narrowing function
    that validates and returns the precise type** (`parseRefPath(collection,
string[])` → `RefPath<T>`; the codecs' decode → read-space values).
    Validation lives there, once.
  - **Do not widen a function's parameter to also accept possibly-invalid
    input for convenience** (e.g. `RefPath<T> | string[]`): the wide arm
    swallows the precise one and silently downgrades compile-time checking
    to runtime for every caller. Keep the function's contract precise and
    let callers narrow first — the call site then documents where the
    validity claim is made.

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
- **Do not use equality comparison on a union/enum-like value as a proxy for
  deciding behavior** (e.g. `if (x.kind !== 'field')`, or
  `expr.kind === 'constant' ? inlineValue(expr) : compileFunction(expr)` —
  where `Expression` gains a new kind every rollout slice). The question such
  code actually asks is not "is it this member?" but "which behavior does
  this value get?" — and the `else` / non-matching side becomes an implicit
  catch-all for _every other member_, so a member added later silently falls
  into it. Use an exhaustive `switch` instead, which forces
  each member's behavior to be stated. Comparisons that are not union-member
  discrimination (e.g. `=== undefined` on an optional, numeric comparisons)
  are fine.
- **Membership tests themselves are not proxies and are allowed.** When the
  question genuinely is "is this value that member?" (a type-predicate
  helper), `===` is the direct expression of it and stays correct as the
  union grows — every new member correctly answers "no". Write such a helper
  as a single boolean expression **without** a hand-written `t is X`
  annotation (e.g. `const isMapType = (t: FieldType) => t.type === 'map'`):
  since TS 5.5 the compiler infers the type predicate from the expression and
  _verifies_ it, whereas an explicit annotation is trusted unchecked. Keep an
  explicit annotation only where inference is impossible (the check is
  delegated to a boolean-returning function, as in `server-value.ts`) or
  where the built-in narrowing is wrong and the annotation deliberately
  overrides it (e.g. `Array.isArray` against `readonly` array unions —
  `isConstantArray` in `pipelines/expression.ts`); say why in a comment, and
  pin inferred predicates in a type test via `expectTypeOf(fn).guards`.
- Enforcement: `typescript/switch-exhaustiveness-check` (with
  `considerDefaultExhaustiveForUnions: false`, `requireDefaultForNonUnion: true`)
  in `.oxlintrc.json` enforces the `switch` rules. The `if`/ternary ban is
  enforceable in principle (a type-aware rule could detect union-typed
  operands), but no existing rule implements it — typescript-eslint has none,
  oxlint's type-aware set (tsgolint) only ports existing typescript-eslint
  rules, and oxlint's custom JS plugins don't expose type information. Until
  such a rule exists, it is upheld by review.

## Test assertions

- **Compare whole values, not field lists.** Assert a result against a single
  hand-written expected value with `toStrictEqual` (which also checks the
  constructor for class instances) instead of enumerating per-field
  assertions. A field list silently stops covering the value when a new field
  is added later; a whole-value oracle cannot miss it, and it shows the
  reader the complete expected shape in one place.
- Use reference equality (`toBe`) only where the API's contract IS identity —
  e.g. `fieldTypeOfPath` returning the schema's own descriptor instance. When
  both sides are freshly constructed there is no canonical instance and
  `toStrictEqual` is the right tool.

## Type-level / runtime mirroring

Some computations exist twice: once in the type system (e.g.
`BuildSelectionSchema`) and once at runtime (e.g. `buildSelectionSchema`),
bridged by a type assertion. The two MUST stay in lockstep — a divergence makes
the types lie about runtime values. To keep them checkable:

- **Mirror the decomposition, not just the result.** Give every type-level
  operator a runtime counterpart with the same name and the same structure:
  if the type is `FoldSelections<Context, DropOverriddenSelections<Args>>`,
  the runtime is `foldSelections(schema, dropOverriddenSelections(args))` —
  each helper pairs 1:1 with its type-level twin
  (`PathToSchema`/`pathToSchema`, `MergeSchemas`/`mergeSchemas`, ...), so each
  step can be reviewed against its twin, including branch-for-branch behavior
  (e.g. a per-recursion-level guard in the type must sit at the same level in
  the runtime helper).
- **Confine the bridging assertion to the entry point** (the one function that
  returns the type-level result), never inside the helpers.
- **Test both sides against one oracle.** For each case, write a single
  hand-written expected value and assert it twice: `toStrictEqual(oracle)`
  checks the runtime value, `expectTypeOf(actual).toEqualTypeOf(oracle)`
  checks the type-level computation (the function's return type IS the
  type-level operator applied to the inputs). If either side drifts, one of
  the two assertions fails. See `buildSelectionSchema (runtime)` in
  `pipelines/selection.test.ts`.

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
