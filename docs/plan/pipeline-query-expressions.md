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
