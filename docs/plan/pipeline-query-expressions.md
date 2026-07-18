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

**Implemented (S2): the predicates key on the `firestoreType` phantom axis.**
Every descriptor carries a third phantom, `firestoreType` (`schema.ts`) — the
type of the values as Firestore classifies them, structurally recursive for
containers, with unions distributing and literals mapping to their base tags.
It exists because the phantom `output` is the TS-representation axis and
conflates pairs Firestore keeps distinct (reference/`string[]`,
vector/`number[]`, geopoint/`{latitude,longitude}` map).

An operation like `toUpper` must accept every descriptor whose **value
domain** fits — `StringType`, `LiteralType<['x','y']>`,
`UnionType<[StringType, ...]>`, `StringType & Optional`, and any future
combination. Enumerating descriptor constructors would combinatorially
explode; a tag-subset predicate expresses the domain structurally:

```ts
type Valued<Tag extends FirestoreType> = FieldType & { firestoreType: Tag | 'null' };
toUpper(s: Expression<Valued<'string'>>): UnaryFunction<StringType>
```

ONE generic predicate (`Valued`, implemented in `expression.ts`) — not an
alias zoo per domain: `where` conditions are `Valued<'boolean'>`, string
operands `Valued<'string'>`, and so on, shared by standalone factories and
fluent `this`-parameters alike.

Consequences (all implemented in S2 unless noted):

- **`null` is special-cased once, inside the machinery — individual domains
  never mention it.** Probed backend semantics make `null` a well-behaved
  operand everywhere (`null` and absent operands flow through functions as
  `null`, comparisons are total, and a non-`true` condition just drops the
  row — see `../pipeline-query-null-semantics-research.md`), so `Valued`
  admits `'null'` tags in every domain: `nullable(string())` is inside the
  string domain, and `... & Optional` operands pass too (the marker does not
  change the tag). (This supersedes an earlier "reject nullable, coalesce
  first" stance.)
- **Comparisons are OVERLAP-based**: `equal(l, r)` is valid iff the
  operands' tag sets intersect (symmetric `Extract` check — `Comparable` in
  `expression.ts`). Grounds: the backend's comparisons are total (probed —
  `equal(null,'x')` is `false`, never an error), so cross-domain rejection
  is a lint against always-false comparisons, and its correct boundary is
  zero overlap — TS's own `===` rule. `equal(field(union(string(),
double())), field(string()))` is legal; reference-vs-`array(string())`,
  vector-vs-`array(double())`, and geopoint-vs-same-shaped-map are rejected
  (the tag axis at work). The rule applies MEMBER-WISE at every depth
  (`TagSetsComparable` recurses into array elements and map fields,
  matching TS's own nested-union handling): a shared element tag is enough
  for two heterogeneous arrays to compare. Consistent with the predicates,
  `'null'` is special-cased at each level: sharing ONLY `'null'` is not
  overlap (`nullable(string())` vs `nullable(timestamp())` is rejected),
  except for a PURE null operand — an is-null check, legal against
  nullable operands and rejected against never-null ones.
- `Int64Type` and `DoubleType` both carry the honest `'integer' | 'double'`
  tag (the SDKs pick the wire encoding per value), which keeps the numeric
  domain mutually comparable — this replaces the old `NumericType` union
  and the number/string overload pairs.
- `where`'s condition type is `Expression<Valued<'boolean'>>` (boolean
  literals and `nullable(bool())` are valid conditions).
- **Return types propagate nullability** (`PropagateNull` /
  `propagateNull`): the logical operators follow Kleene three-valued logic
  (probed — `and(true, null)` is `null`, see the null-semantics research
  doc), so `and` / `or` / `not` return `nullable(bool())` when any
  operand's tags include `'null'` OR the operand is `& Optional` (absence
  flows through functions as `null`). Comparisons stay plain `BoolType`
  (total). Value functions in later slices reuse `PropagateNull`.
- Return types widen to the plain descriptor (`toUpper` of a literal returns
  `StringType`) — values are transformed, so precision loss is correct.

### Direct literal operands (no explicit `constant()`) — DONE (2026-07)

Raw values are writable directly as operands —
`equal(field('rank'), 1)`, `startsWith(field('name'), 'a')`,
`equal(field('__name__'), docRefValue(...))` — with the factory lifting them
via `constant()` internally, exactly like the official SDK
(`equal(field('x'), 5)`).

The final rule, applied uniformly across EVERY factory (no per-function
ad-hoc overloads):

- An operand position takes `OperandInput` (`Expression | ConstantValue`),
  narrowed by a domain-input alias where the domain is constrained
  (`NumericOperandInput`, `StringOperandInput`, `BooleanOperandInput`,
  `TimestampOperandInput`, `ArrayOperandInput`, `MapOperandInput`,
  `ReferenceOperandInput`, `VectorOperandInput`; each is the expression domain
  widened with the raws that lift into it, plus `null`). Unconstrained
  positions (conditional branches, `logicalMaximum`/`logicalMinimum`,
  `if*` fallbacks, `type`/`isError`) take the bare `OperandInput`.
- The operand's descriptor is read type-side via `TypeOfOperand<X>` (never
  `X['type']`), and lifted runtime-side via `toOperand` / `liftOperands`
  (tuple-preserving) / `liftFields` (record-preserving for `mapValue`) BEFORE
  any runtime type-computation bridge (`propagateNull`, `numericResultType`,
  ...). Every generalized type parameter is `const` so raw literals infer
  their narrow descriptor.
- BOTH sides may be raw (`equal(1, 2)`, `add(1, 2)`) — inference is anchored
  by the parameter positions, no `Expression` needed anywhere.
- Value constructors (`geoPointValue` / `vectorValue` / `docRefValue`) are
  `ConstantValue` leaves, so they ride the exact same lifting rule.
- `equalAny` / `notEqualAny` accept a **raw array** in the `options` position
  (`equalAny(f, [1, 5, 9])`): a plain array is a `ConstantValue`, so it lifts
  to an array constant and the element-comparability guard runs against the
  lifted `ArrayType`'s element — this is the resolution of open question 3's
  remainder (plain-array sugar), not a special case. Likewise a raw plain
  object in a map operand lifts through `Constant.of` to a map CONSTANT (NOT
  a `mapValue(...)` constructor node).
- EXCLUDED: `exists` / `isAbsent` keep `Field`-only operands — the backend
  requires a field reference there (probed: any other expression, constants
  included, is `INVALID_ARGUMENT`), so widening would only defer a guaranteed
  failure to runtime.

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

Every slice MUST add its functions to the live spec's **function catalog**
(`pipeline-spec.ts`, "function catalog" describe): one straightforward
constant-operand evaluation per function, pinning the wire translation of
both executors and the basic backend semantics in one round trip per family.

- [x] **0. Shapes + comparison + logical core** (#213).
- [x] **1. `constant` type inference.** `ConstantTypeOf<V>` (type) mirrored by
      `constantTypeOf` (runtime). Classification: everything with an
      unambiguous plain-JS representation goes through `constant()` — scalars
      (`string | number | boolean | null | Date | Uint8Array`), non-empty
      arrays (element descriptors dedup **in tuple order** — walking the tuple
      keeps the order stable so the runtime mirrors it exactly; heterogeneous
      elements become an `ArrayType<UnionType<[...]>>`), and plain-object maps
      (recursive). Firestore types WITHOUT their own JS representation are
      dedicated nodes: `GeoPointValue` / `VectorValue` — a plain object is
      always a map constant, a `number[]` always an array constant. The nodes
      double as **composite leaves** (`constant({ spot: geoPointValue(1, 3) })`),
      mirroring the SDK's nested `GeoPoint` support. All
      numbers map to `DoubleType` (wire integer encoding is the SDK's
      concern). This fixed the reachable descriptor-lie crash
      (`type: 'todo'`) and pulled the comparison operators onto value-domain
      predicates (`NumberValued` / `StringValued`
      overloads before the same-`T` fallback) so literal-typed fields compare
      against plain constants. Executors translate per value type (plain
      `GeoPoint` → SDK class; `Uint8Array` → `Bytes` on the client SDK).
- [x] **1.5. `firestoreType` phantom + predicate migration (S2)** — the tag
      axis on every descriptor, null-tolerant domains, overlap-based
      comparisons (single signature replaces the per-domain overload
      triples with `'null'` special-cased once in the machinery),
      `where` / `and` / `or` / `not` on `Valued<'boolean'>`, and Kleene
      null propagation into logical return descriptors (`PropagateNull`).
      See
      "Operand constraints are value-domain predicates" above.
- [x] **2. Arithmetic + string basics** (T1 bulk; introduces
      `NullaryFunction` for `rand` and the dual-arity pattern early —
      `round` / `trunc` take optional decimal places, the `trim` family an
      optional character set, each overloading to unary + binary shapes).
      Notes: the SDK has no standalone `log` (only `ln` / `log10`);
      `stringConcat` is the string-typed concat (bare `concat` is the
      generic form). All slice-2 functions PROPAGATE null — including the
      boolean-returning string predicates (`startsWith(null, 'x')` is
      `null`), unlike the total comparisons. Arithmetic error edges
      (divide by zero, `ln(0)`, `sqrt(-1)`) produce backend ERROR values
      for the slice-5 `isError` / `ifError` channel. Probed: integer /
      integer division TRUNCATES (a whole JS number wire-encodes as an
      integer) — pinned in the live spec.
- [x] **3. String rest + regex + reference + type + vector** (T1 bulk #2;
      introduces `TernaryFunction`; `substring` reuses the dual-arity
      pattern — `stringReplace*` turned out fully ternary). Notes:
      `split` / `join` deferred to the array slice (their typing IS array
      typing). Probed: `regexFind` returns null on NO MATCH (always-nullable
      return, independent of operands) while `regexFindAll` returns `[]`;
      invalid regex patterns and vector dimension mismatches are backend
      ERROR values; `type()` / `isType()` are type-OBSERVING — a null value
      yields the name `'null'`, so only ABSENCE propagates
      (`PropagateAbsence`). `type()`'s vocabulary is the backend naming
      (`int64` / `float64` / `geo_point`, distinct per VALUE — another
      artifact of the honest numeric tag), pinned as
      `LiteralType<FirestoreTypeName[]>`; `isType`'s name must be a
      wire-literal (factory takes a literal union, lifted via `constant`;
      executors recover the raw string for the SDK helpers). The reserved
      `__name__` is a REFERENCE (probed via `type(__name__)`), so
      `FieldTypeOfPath` now resolves it to the context-free
      `DocRefType<'unknown'>` (ONE unified reference descriptor — the type
      parameter is the known collection or the `'unknown'` sentinel; both
      flavors read/write `RefPath` segment paths since the segment-path
      unification). Future refinement, same skeleton: while a
      pipeline's read-identity is alive (`Id = DocRef<T>`), the source
      collection IS statically known — `fieldProvider` could resolve
      `'__name__'` to `DocRefType<T>` and fall back to `'unknown'` once the
      identity ratchet drops (deferred; `documentId` covers today's uses) — `documentId(field('__name__'))` bridges it
      into the string domain, and comparing `__name__` against strings is
      now correctly rejected (probed: the backend matches NO string form —
      only a reference value). `docRefValue(refPath)` joins
      `geoPointValue` / `vectorValue` as the third dedicated value node
      (same classification rule: a segment path is a plain `string[]` = an
      array constant) and is the matching comparand; executors thread `db`
      to build the wire reference (the codec's `buildEncodeField`
      precedent). Value nodes are NOT expressions: `constant()` is the one
      point where any value (scalar, map, `geoPointValue` / `vectorValue` /
      `docRefValue`) lifts into an expression, matching the SDK's
      `constant(new GeoPoint(...))` — this closed the hole where every value
      node inhabited every operand domain (`toUpper(geoPointValue(...))`
      type-checked), and needed no type-level membership trick.
- [x] **4. Timestamp family** (`currentTimestamp`; unix conversions ×6;
      `timestampAdd` / `timestampSubtract` / `timestampDiff` (ternary);
      `timestampTruncate` / `timestampExtract` (dual arity over the optional
      timezone) — the SDK-only extras `timestampDiff` / `timestampExtract`
      were included beyond the original inventory). The isType literal-lift
      pattern generalized cleanly: probed, the backend REQUIRES literal
      constants for unit / granularity / part AND the timezone (a dynamic
      operand is INVALID_ARGUMENT at validation, not an ERROR value), so the
      factories take literal-union parameters (`TimeUnit` ⊂
      `TimeGranularity` ⊂ `TimePart`, `timezone: string`) lifted via
      `Constant.of`; the executors pass the translated constant expressions
      straight through (no raw-string recovery needed — the SDK standalone
      signatures accept expression forms). Probed semantics pinned in the
      catalog: integer-only amounts/epochs (a fractional value cannot
      coerce), diff truncates toward zero and is negative when end precedes
      start, bare `'week'` truncates to Sunday vs `'week(monday)'` /
      `'isoweek'`, `'dayofweek'` is 1-based from Sunday, out-of-range
      results and invalid timezone VALUES are backend ERROR values. All
      value functions propagate null (incl. absent → null).
- [x] **5. Existence/error + conditional + logicalMax/Min + equalAny/notEqualAny**
      (T2: operand-derived return types, fallback unions; `ifNull` and `xor`
      included beyond the inventory line). Probed semantics:
      `exists`/`isAbsent` are absence-observing, total, and take FIELD
      REFERENCES only (the backend rejects any other operand at validation —
      the factories take `Field`); `isError` is total (null/absent are
      `false`); `ifError` passes null AND absence through the try side (only
      errors trigger the fallback); `ifAbsent` triggers on absence only (a
      present null passes); `ifNull` triggers on null OR absence; ERROR
      values propagate through everything except `isError`/`ifError`;
      `conditional` is NOT Kleene — a null/absent/false condition selects
      `else`; `logicalMaximum`/`logicalMinimum` IGNORE null/absent operands
      (unlike sort's null-first order) and return null only when every
      operand was ignored; `equalAny`/`notEqualAny` are total and take ONE
      array-typed options expression (`constant([...])` / an array field —
      the SDK's values-list form is client sugar, and a non-constant
      expression inside it is rejected on the wire), with elements
      type-checked comparable against the value (`ElementsOf` +
      `Comparable`); `xor` is variadic parity with Kleene null propagation.
      New return-type machinery, each with a runtime twin:
      `EitherType` (branch union, deduped), `StripNull` (null-stripped
      pass-through sides), `LogicalExtreme` (stripped operand union +
      null iff all operands nullable), and `WithoutOptional` — an operand's
      `Optional` marker is a property of its document slot, never of a
      function result, so result descriptors drop it.
- [~] **6. Array + map families + `arrayValue` / `mapValue` constructors**
  (T3: element/subschema return typing). Probed (2026-07,
  `.ikenox/probe-slice6.mjs` — full results there): - The constructors are EXPRESSION constructors, not value nodes:
  elements/values may be expressions (`array([field('num'), 9])`),
  recursively through nested plain arrays/objects; empty forms are
  valid. They need their own AST shapes (element list / field record —
  `VariadicFunction` requires >= 2 operands). - `mapGet`: the key MAY be dynamic (unlike the timestamp literals);
  missing key -> ABSENT; null/absent map -> null; nests. - `arrayGet`: dynamic index OK, negative = from the end,
  out-of-range -> ABSENT (isError false — NOT an error value). - `mapSet` keys are the one literal-constant requirement
  ("map_set keys must be constants/literals"); dynamic values fine;
  `mapSet(null-map, ...)` -> ABSENT (quirk). `mapMerge` is
  last-wins; `mapRemove` of a missing key is a no-op. - contains family: the ARRAY operand's null/absent propagates
  (`arrayContains(missing, 1)` -> null) but a null ELEMENT is compared
  as a value (`arrayContains([1,null,3], null)` -> true;
  `arrayContains([1,2,3], null)` -> false). `arrayContainsAll/Any`
  accept one array-typed options expression (like `equalAny`). - `arrayConcat` is variadic (>= 2), null operand propagates. - `mapKeys` -> string[]; `mapValues` -> element union;
  `mapEntries` -> array of `{ k, v }` maps.
  Scope: the plan inventory + `arrayReverse`. The SDK's LARGER array
  surface is deliberately deferred to a follow-up item (below).
- [ ] **6b. Array extras (deferred from slice 6)**: the SDK also exports
      arrayFirst/arrayLast(+N variants), arrayIndexOf(All)/arrayLastIndexOf,
      arrayMaximum/arrayMinimum(+N), arraySlice, arraySum — mechanical
      shapes — plus arrayFilter / arrayTransform(WithIndex) (need a LAMBDA
      expression concept) and arrayAgg(Distinct) (aggregate-flavored).
      Include the mechanical ones in a follow-up pass; the lambda and
      aggregate ones need their own design.
- [x] **7. Numeric return refinement** (T4). Probed via `type(...)`: the
      type-preserving operators (add / subtract / multiply / mod — and
      divide, which truncates on integers — plus abs / ceil / floor /
      round / trunc, decimal places notwithstanding) keep int64 when every
      numeric operand is int64; `pow` / `sqrt` / `exp` / `ln` / `log10` are
      ALWAYS doubles. `NumericResult<Ops>` (+ runtime twin) refines on the
      DECLARED descriptor (`int64()` vs `double()` — both carry the same
      honest tag; a stored `2.0` reads back as wire int64, confirming the
      honest-tag design). Number constants are `DoubleType`, so a constant
      operand widens to double. No other leftovers — the deferred lists
      (6b array extras, lambda/aggregate functions) stand on their own.
- [ ] **8. Fluent methods on `ExpressionBase`** (decision pending — see open
      questions).

## Test strategy

- [ ] **Planned cleanup — layer the expression tests (agreed 2026-07, not
      yet done).** A `toStrictEqual` whose expected value is a TRANSCRIPTION
      of the implementation (the construction oracles like
      `expect(add(l, r)).toStrictEqual(new FunctionCall(...))`) verifies
      nothing durable: since the payload-union restructure the payload shape
      is fully compile-checked, and a factory that forgets to lift an
      operand is a compile error (payload fields are typed `Expression`).
      Keep a `toStrictEqual` only when the two sides come from DIFFERENT
      sources (another construction path, the live backend, a probed fact).
      Concretely: 1. DELETE the per-function construction-restatement oracles and the
      per-function raw-vs-`constant()` lifting oracles. 2. ADD one mechanism-layer describe for `toOperand` / `liftOperands` /
      `liftFields` (scalar, value node, expression pass-through, tuple
      arity, record — each once); the live direct-literal catalog case
      stays as the end-to-end check. 3. KEEP the return-descriptor semantics tests (null propagation,
      numeric kinds, `EitherType`/`StripNull`, key-aware map types, ...)
      — they pin the loosely-checked runtime bridges — and unify their
      `toStrictEqual` + `expectTypeOf` pairs behind a new
      `expectTypedStrictEqual(actual, expected)` helper: runtime
      `toStrictEqual` plus a compile-time EXACT type-equality guard
      (invariance trick), so the value claim and the type claim can
      never drift apart. vitest has no built-in for this (its matchers
      stay loosely typed so asymmetric matchers like `expect.any` work);
      the helper deliberately rejects matchers — descriptor expectations
      are always whole values. Pure type-level assertions with no value
      (`expectTypeOf<...>()` forms, `.guards`) stay as `expectTypeOf`. 4. Note the layering rule in `docs/coding-guideline.md` (the
      whole-value principle targets DATA results; compiler-verified
      construction is not restated in tests). (The
      `ConstantTypeOf`/`constantTypeOf` element-position oracle gaps —
      null elements/fields, a reference node as an array element,
      same-kind value-node dedup — were filled in #232.)
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
3. **`equalAny` sugar** — RESOLVED (slice 5 + direct-literal operands,
   2026-07): the options operand is one array-typed operand — an array
   EXPRESSION (`constant([1, 2, 3])`, an array field, ...) OR a raw array
   `[1, 2, 3]` that lifts to an array constant under the uniform direct-literal
   rule (see "Direct literal operands" above). The plain-array sugar is that
   lifting rule, not a special case.
4. **How far to take T3 typing** for `mapGet` / `mapSet` / `mapMerge`
   (key-aware subschema lookup vs a loose `MapType` return) — the old TODOs
   suggest key-aware; cost is real type-level machinery.
5. ~~**`xor` arity**~~ — RESOLVED (slice 5): variadic parity like `and`/`or`.
   `log` signature (`log(x)` natural vs `log(x, base)`) still to verify —
   the SDK has no standalone `log` today.
