# Pipeline Query — `sort` ordering semantics

> Empirical notes on how the pipeline `sort` stage orders rows, focusing on
> where it diverges from core-query `orderBy`. Probed 2026-07 against a real
> Firestore Enterprise database (`ikenox-sunrise` /
> `enterprise-native-playground`) via `@google-cloud/firestore@8.6.0`
> (`probe-sort-missing.mjs` under gitignored `./.ikenox/`).

## Rows missing the sort field are kept, not excluded

The core-query `orderBy` **excludes** documents that lack the ordered field
(an artifact of index-based execution). Pipeline `sort` — index-optional —
**keeps** them and gives absence a position in the total order.

## The total order around absence

Seeded `v: 1`, `v: 3`, `v: null`, and a document without `v` (re-probed
2026-07, `.ikenox/probe-spec-coverage2.mjs`):

```
sort(v ascending):   (absent)  <  null  <  1  <  3
sort(v descending):  3  >  1  >  (absent)  >  null   (NOT an exact mirror)
```

- `null` and _absent_ are **distinct positions**, both ordering **below every
  present value**, with **`absent` < `null`** (an absent field sorts before a
  genuine `null` ascending).
- **Descending reverses only the PRESENT values.** The `{absent, null}` block
  stays below the values and keeps its `absent` < `null` sub-order — so
  descending is **NOT** the exact mirror of ascending (a true reverse would put
  `null` before `absent`). This unifies with the values-only + absent case
  (`profile.gender`, no `null`): the absent row is first ascending and last
  descending because "below all present values" lands at the opposite end when
  the values flip.
- **Correction:** an earlier revision of this doc recorded `null < absent` and
  an "exact mirror" descending. Both were wrong; the live backend orders
  `absent < null` and does not mirror the pair. Pinned by the pipeline spec's
  `sort › null vs absent are distinct positions`.

Covered by the pipeline spec: sorting the authors seed by the optional
`profile.gender` keeps the document lacking it (first ascending, last
descending).

## Multiple sort keys

Standard lexicographic behavior — the earlier ordering takes precedence and
later orderings break its ties (covered by the spec's composite-keys case).
