/**
 * The query of a `search` stage.
 *
 * Deliberately NOT an {@link Expression} — the `AggregateFunction` precedent.
 * The backend accepts exactly ONE `document_matches` call here and rejects
 * every other expression, including `and` / `or` / `not` over it and ordinary
 * field comparisons (probed — see `docs/pipeline-query-search-research.md`), so
 * keeping the query off the expression union makes those a COMPILE error
 * instead of a runtime `INVALID_ARGUMENT`. It is a union so it can grow as the
 * backend's accepted set does: the geospatial predicate becomes a second
 * member, and the rejection message for `and` says "not supported **yet**".
 */
export type SearchQuery = DocumentMatches;

/**
 * A full-text match against every text-indexed field of the document — the
 * backend's `document_matches`.
 *
 * `rquery` is a plain string, not an expression: the backend requires a string
 * LITERAL there ("The 'query' argument of the 'document_matches' function must
 * be a literal value" — probed), the same reason `isType`'s type name and the
 * map keys are plain payload fields.
 */
export type DocumentMatches = { kind: 'documentMatches'; rquery: string };

/**
 * Builds a full-text match over all text-indexed fields of the document, for a
 * `search` stage's `query`.
 *
 * `rquery` is written in the backend's search DSL:
 *
 * | form            | meaning                                          |
 * | --------------- | ------------------------------------------------ |
 * | `waffles`       | a single term                                    |
 * | `waffles syrup` | AND — both terms required                        |
 * | `"belgian waffles"` | an exact phrase                              |
 * | `coffee -syrup` | exclusion                                        |
 * | `waffles\|syrup` | OR — the pipe, with NO surrounding spaces        |
 *
 * Note the disjunction spelling: `'a|b'` disjoins, while the `'a OR b'` form
 * shown in the official docs does NOT — `OR` is matched as an ordinary term
 * (probed). Only fields covered by a text index are searched; a term found only
 * in an unindexed field matches nothing, and a document whose indexed field is
 * absent or `null` simply never matches.
 */
export const documentMatches = (rquery: string): DocumentMatches => ({
  kind: 'documentMatches',
  rquery,
});

/**
 * The `search` stage's ordering — how the matched documents come back.
 *
 * NOT the pipeline's {@link Ordering}: the backend takes no ordering
 * expression here at all, only a fixed target-and-direction pair, and rejects
 * everything else — a field ordering, `__name__`, two orderings, and even
 * `score()` ASCENDING (probed). Omitting it orders by document creation time,
 * NEWEST first.
 *
 * The `direction` is part of the model rather than implied by the target
 * because the geospatial arm sorts the other way (the backend's message pairs
 * `geo_distance()` with geo queries and `score()` with text queries), so this
 * grows into `| { by: 'geoDistance'; ...; direction: 'ascending' }` rather than
 * being redesigned.
 */
export type SearchOrdering = { by: 'score'; direction: 'descending' };
