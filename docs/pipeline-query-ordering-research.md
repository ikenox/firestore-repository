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

Seeded `v: 1`, `v: 3`, `v: null`, and a document without `v`:

```
sort(v ascending):   null  <  (absent)  <  1  <  3
sort(v descending):  3  >  1  >  (absent)  >  null   (exact mirror)
```

- `null` and _absent_ are **distinct positions**: `null` orders before an
  absent field ascending.
- Both order before every present value; descending is the exact reverse
  (absence is not pinned to one end).

Covered by the pipeline spec: sorting the authors seed by the optional
`profile.gender` keeps the document lacking it (first ascending, last
descending).

## Multiple sort keys

Standard lexicographic behavior — the earlier ordering takes precedence and
later orderings break its ties (covered by the spec's composite-keys case).
