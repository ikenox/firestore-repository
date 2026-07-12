# Pipeline Query — `null` / absent semantics in expressions

> Empirical notes on how pipeline expressions treat `null` values and absent
> fields. Probed 2026-07 against a real Firestore Enterprise database
> (`ikenox-sunrise` / `enterprise-native-playground`) via
> `@google-cloud/firestore@8.6.0` (`probe-logical-null.mjs` under gitignored
> `./.ikenox/`, plus earlier probes referenced from the plan docs).

## Absent behaves as `null` inside expressions

An operand referencing a missing field behaves exactly like a `null` operand
in every probed expression (logical operators below, and value functions /
comparisons in earlier probes): absence merges into `null` the moment a value
enters an expression. Presence is only distinguishable at the projection
layer (leaf-absence in `select` output).

Library consequence: the type model needs no `'absent'` tag on the
`firestoreType` axis — presence stays on the orthogonal `optional` marker —
but **return-type null propagation must count `Optional` operands as
possibly-null** (`PropagateNull` in `pipelines/expression.ts`).

## Logical operators use Kleene three-valued logic

`and` / `or` / `not` do NOT coerce `null` to `false`; `null` means "unknown"
and propagates unless the other operand decides the result:

```
and(true,  null) -> null      or(true,  null) -> true
and(false, null) -> false     or(false, null) -> null
and(null,  null) -> null      or(null,  null) -> null
not(null)        -> null
```

(Absent operands: identical, per the merge rule above.)

So a logical expression over a possibly-null operand is itself possibly null
— the library propagates this into the result descriptor (`PropagateNull`:
`BoolType` becomes `UnionType<[BoolType, NullType]>` when any operand can be
null or absent).

Note the interplay with `where`: a `null` condition drops the row (truthy-only
semantics — only exactly `true` keeps it), so Kleene `null` and `false` are
indistinguishable there. The distinction matters as soon as the expression's
VALUE is observed — projected via `select` / `addFields`, or used as an
operand of another function.

## Value functions propagate `null` — including boolean-returning ones

Every probed slice-2 function returns `null` when any operand is `null` or
absent (`probe-slice2-null.mjs`): arithmetic (`add(7, null)`), string
transforms (`toUpper(null)`), lengths, `stringConcat` — and notably the
boolean-returning string predicates (`startsWith(null, 'x')` is `null`,
absent operands identical). Their results are therefore possibly-null
descriptors under `PropagateNull`, in contrast to the comparisons below.

## Errors are a separate channel from `null`

Arithmetic domain violations (`divide(x, 0)`, `ln(0)`, `sqrt(-1)`) do NOT
yield `null`: they produce backend ERROR values. An unhandled error value
fails the whole query (`INVALID_ARGUMENT`), while `isError(...)` observes it
(`true`) and `ifError(..., fallback)` replaces it — the error-handling
functions arrive in slice 5.

## Comparisons are total — never `null`

`equal` / `notEqual` / `lessThan` / ... always return `true` or `false`, even
over `null` / absent operands (`equal(null, 'x')` is `false`,
`equal(null, null)` is `true` — probed earlier, see the expressions plan).
Comparison results therefore stay plain `BoolType` with no null propagation.
