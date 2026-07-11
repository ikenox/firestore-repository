# Pipeline Query — expression function restoration plan

Working plan for restoring the ~100 expression factories (trimmed in
`a922924`; full inventory recoverable from `96b5d13`). Split out of
[`pipeline-query.md`](./pipeline-query.md) because of its volume. Status
markers follow the same conventions.

## Grounding (what the design is derived from)

Two sources only — the old implementation is a **reference inventory**, not an
authority:

1. **The wire model.** Every function is a proto
   `FunctionExpression(name, params: Expression[])`: parameters are uniformly
   expressions, and the SDK itself normalizes literal arguments (time units,
   regex patterns, amounts) into constant expressions (`valueToDefaultExpr`).
   Verified against the SDK source, and every such SDK factory also has an
   all-`Expression` overload, so lifted constants translate through
   `toSdkExpression` without unwrapping.
2. **This library's type-guarantee policy** (schema threading, exhaustive
   unions, type/runtime mirroring, "ban what would silently succeed against
   the type model; leave loud failures to the backend").

## Settled design

### Class tree (flat, one level deep)

```
ExpressionBase                     abstract: .as() and future fluent methods
│  ── value nodes ──
├── Field<T, Path>                 kind: 'field'
├── Constant<T>                    kind: 'constant'
├── ArrayValue<...>                kind: 'arrayValue'  — array(...) constructor  [new]
├── MapValue<...>                  kind: 'mapValue'    — map({...}) constructor  [new]
│  ── function nodes, grouped by SHAPE ──
├── NullaryFunction<T>             (no payload)                                  [new]
├── UnaryFunction<T>               operand
├── BinaryFunction<T>              left / right
├── TernaryFunction<T>             first / second / third                        [new]
└── VariadicFunction<T>            operands: [E, E, ...E[]]

Expression<T> = discriminated union of all leaves (narrowed via `kind`)
```

- **No intermediate abstract layers**: per-shape `name` unions can't share a
  base field, and the executors' `kind` switch + `Record<Name, ...>` tables
  want concrete leaves.
- **No `BooleanExpression` class**: `Expression<BoolType>` already encodes it;
  executors wrap with the SDK's `asBoolean()` (type-tag only).
- **No per-function classes** (rejected: ~100 classes, giant union, per-SDK
  100-case switches).

### Where each concern lives

| concern                                                                     | home                                                                              |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| arity / payload shape                                                       | the shape classes                                                                 |
| operand type constraints                                                    | **value-domain predicates** + factory overloads (see below)                       |
| literal arguments (`TimeUnit`, `FieldTypeName`, regex patterns, separators) | factory signatures (literal unions), lifted via `constant()` — wire-faithful      |
| derived return types (`logicalMaximum<T>`, `mapGet` subschema lookup)       | factory type parameters / return types                                            |
| SDK translation                                                             | per-shape `Record<Name, fn>` tables in each executor (exhaustive by construction) |

### Operand constraints are value-domain predicates, not descriptor unions

An operation like `toUpper` must accept every descriptor whose **value domain**
is a subset of string — `StringType`, `LiteralType<['x','y']>`,
`UnionType<[StringType, ...]>`, `StringType & Optional`, and any future
combination. Enumerating descriptor constructors would combinatorially
explode; instead the phantom `output` type the descriptors already carry
(valibot-style) expresses the domain structurally:

```ts
type StringValued = FieldType & { output: string };
toUpper(s: Expression<StringValued>): UnaryFunction<StringType>
```

Verified: literals / string unions are accepted covariantly; `double()`,
`nullable(string())` (null in the domain), and mixed unions are rejected.
One alias per domain (`StringValued` / `NumberValued` / `BooleanValued` /
`TimestampValued` / ...), shared by standalone factories and fluent
`this`-parameters alike.

Consequences adopted with it:

- The existing `NumericType = Int64Type | DoubleType` union is superseded by
  `NumberValued` (numeric literals become comparable).
- `where`'s condition type becomes `Expression<BooleanValued>`.
- `nullable(...)` operands are **rejected** (strict): coalesce first
  (`ifAbsent` etc., slice 5) rather than inheriting backend null semantics.
- `... & Optional` operands pass (the domain is right; absence propagation is
  backend semantics, probed in slice 5).
- Return types widen to the plain descriptor (`toUpper` of a literal returns
  `StringType`) — values are transformed, so precision loss is correct.

### Optional arguments (e.g. `substring(s, start, len?)`)

The factory overloads to **two shapes**: 2-arg calls build a `BinaryFunction`,
3-arg calls a `TernaryFunction`; the same name deliberately appears in both
shape name unions and each executor table translates its arity. Payloads stay
fully required — no runtime guards.

### Aggregates are a separate mini-tree

`sum` / `avg` / `count` / ... are only valid inside the `aggregate` stage —
keeping them out of `Expression` makes misplacement (e.g. `where(sum(...))`) a
type error:

```
AggregateBase          .as() → AggregateWithAlias
├── NullaryAggregate   'count'
└── UnaryAggregate     'sum' | 'avg' | 'minimum' | 'maximum' | 'countIf' | ...
```

(Design detail deferred to the aggregate-stage work.)

## Inventory (unique factories from `96b5d13`, by category)

Tiers grade the typing sophistication needed: **T1** fixed return type +
simple operand constraint; **T2** return type derived from operand types;
**T3** return type derived from operand _structure_ (element / subschema
lookup); **T4** cross-cutting type-system work.

| category          | functions                                                                                                                                                                                                                               | shapes                                | tier                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------- |
| comparison        | ~~equal, notEqual, lessThan, lessThanOrEqual, greaterThan, greaterThanOrEqual~~ (done) / equalAny, notEqualAny                                                                                                                          | binary                                | T1 / T2 (array operand)                            |
| logical           | ~~and, or, not~~ (done) / xor, conditional, logicalMaximum, logicalMinimum                                                                                                                                                              | variadic / ternary / variadic         | T1 / T2 (operand-typed returns)                    |
| existence & error | exists, isAbsent, isError, ifAbsent, ifError                                                                                                                                                                                            | unary / binary                        | T1 / T2 (fallback union)                           |
| arithmetic        | add, subtract, multiply, divide, mod, pow, abs, ceil, floor, round, trunc, sqrt, exp, ln, log, rand                                                                                                                                     | binary / unary / nullary              | T1 (+T4 numeric refinement)                        |
| string            | charLength, byteLength, toLower, toUpper, trim, ltrim, rtrim, stringReverse, concat / stringConcat, startsWith, endsWith, stringContains, stringIndexOf, stringRepeat, stringReplaceAll, stringReplaceOne, substring, like, split, join | unary / binary / ternary / variadic   | T1 (split/join touch arrays: T3-lite)              |
| regex             | regexContains, regexMatch, regexFind, regexFindAll                                                                                                                                                                                      | binary                                | T1                                                 |
| array             | array (constructor), arrayConcat, arrayContains, arrayContainsAll, arrayContainsAny, arrayGet, arrayLength                                                                                                                              | value node / binary / variadic        | T3 (element typing)                                |
| map               | map (constructor), mapGet, mapSet, mapMerge, mapRemove, mapKeys, mapValues, mapEntries                                                                                                                                                  | value node / unary / binary / ternary | T3 (subschema typing)                              |
| timestamp         | currentTimestamp, timestampAdd, timestampSubtract, timestampToUnix{Seconds,Millis,Micros}, unix{Seconds,Millis,Micros}ToTimestamp, timestampTruncate                                                                                    | nullary / unary / ternary             | T1 (literal `TimeUnit` / granularity in factories) |
| vector            | cosineDistance, dotProduct, euclideanDistance, vectorLength                                                                                                                                                                             | binary / unary                        | T1                                                 |
| type              | type, isType                                                                                                                                                                                                                            | unary / binary                        | T1 (literal `FieldTypeName`)                       |
| reference         | documentId, collectionId                                                                                                                                                                                                                | unary                                 | T1                                                 |

Cross-cutting (T4, tracked in the main plan doc's "Expressions — remaining
gaps"): `constant(value)` type inference from the runtime value; Int64/Double
return-type refinement for arithmetic; vector dimension typing (if ever).

## Rollout slices (one PR each, TDD with live spec per slice)

- [x] **0. Shapes + comparison + logical core** (#213).
- [x] **1. `constant` type inference.** `ConstantTypeOf<V>` (type) mirrored by
      `constantTypeOf` (runtime). Classification: everything with an
      unambiguous plain-JS representation goes through `constant()` — scalars
      (`string | number | boolean | null | Date | Uint8Array`), non-empty
      homogeneous arrays (heterogeneous elements rejected at the type level,
      runtime twin guarding nested occurrences), and plain-object maps
      (recursive). Firestore types WITHOUT their own JS representation are
      dedicated nodes: `GeoPointValue` / `VectorValue` — a plain object is
      always a map constant, a `number[]` always an array constant. All
      numbers map to `DoubleType` (wire integer encoding is the SDK's
      concern). This fixed the reachable descriptor-lie crash
      (`type: 'todo'`) and pulled the comparison operators onto value-domain
      predicates (`NumberValued` / `StringValued`
      overloads before the same-`T` fallback) so literal-typed fields compare
      against plain constants. Executors translate per value type (plain
      `GeoPoint` → SDK class; `Uint8Array` → `Bytes` on the client SDK).
- [ ] **2. Arithmetic + string basics** (T1 bulk: binary/unary flows already
      paved; introduces `NullaryFunction` for `rand`).
- [ ] **3. String rest + regex + reference + type + vector** (T1 bulk #2;
      introduces `TernaryFunction` and the dual-shape optional-arg pattern via
      `substring` / `stringReplace*`).
- [ ] **4. Timestamp family** (literal-union factory args pattern:
      `TimeUnit`, truncation granularity).
- [ ] **5. Existence/error + conditional + logicalMax/Min + equalAny/notEqualAny**
      (T2: operand-derived return types, fallback unions).
- [ ] **6. Array + map families + `ArrayValue` / `MapValue` constructors**
      (T3: element/subschema return typing; needs a wire probe for the
      constructor encodings; ties into the existing `arrayGet` / `mapGet`
      TODOs).
- [ ] **7. Numeric return refinement + any leftovers** (T4).
- [ ] **8. Fluent methods on `ExpressionBase`** (decision pending — see open
      questions).

## Test strategy

- **Type tests** (operand compatibility incl. rejections, return types):
  every factory, in `expression.test.ts` — cheap, no I/O.
- **Live spec**: one _batched_ case per category rather than one per function
  — a single `addFields` with many computed aliases verifies N translations
  and N backend evaluations in one round trip:

  ```ts
  source().addFields((f) => [
    add(f('rank'), constant(1)).as('a'),
    toUpper(f('name')).as('b'),
    ...
  ])
  ```

- **Probes** before slices with unverified semantics: array/map constructor
  wire encodings (slice 6); anything the docs leave unspecified (e.g. error
  values — what `divide(x, 0)` yields — feeds the existence/error slice).

## Open questions (to settle before / during the slices)

1. **Fluent methods** (`field('price').multiply(x).as('total')`), SDK-style.
   Findings: the official SDK puts **all ~174 functions on `Expression` as
   methods** (plus standalone forms) with **no type restrictions** (untyped
   model). We can do better: `this`-parameter types (verified) restrict each
   method to its value domain from the shared base —
   `toUpper(this: Expression<StringValued>)` — so `field('rank').toUpper()`
   is a compile error here while legal in the SDK. Methods are one-line
   delegations to the standalone factories, hence mechanically addable later
   and non-breaking. Plan: standalone-only through slices 1–7; bulk-add
   fluent (likely full parity) in slice 8.
2. **Naming**: mirror SDK names verbatim? The old file had both `concat` and
   `stringConcat` (SDK quirk); collision risk with `schema.ts` factories
   (`array` / `map` constructors — the old file aliased its schema imports).
   Proposal: SDK names verbatim, constructors as `arrayValue` / `mapValue` to
   dodge the schema collision.
3. **`equalAny` sugar**: accept a plain JS array (`equalAny(f, [1, 2, 3])`)
   lifted to an `ArrayValue`, or require explicit `arrayValue([...])`?
4. **How far to take T3 typing** for `mapGet` / `mapSet` / `mapMerge`
   (key-aware subschema lookup vs a loose `MapType` return) — the old TODOs
   suggest key-aware; cost is real type-level machinery.
5. **`xor` arity** (SDK: variadic like `and`/`or`?) and `log` signature
   (`log(x)` natural vs `log(x, base)`) — verify against the SDK during their
   slices.
