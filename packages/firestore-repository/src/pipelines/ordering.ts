import type { Expression } from './expression.js';

/**
 * One sort key: any expression, in either direction.
 *
 * The key is an EXPRESSION, not just a field — probed, the backend sorts by a
 * computed value as readily as by a stored one, which is what makes a
 * case-insensitive sort (`asc(toLower(field('name')))`) expressible without
 * denormalizing a column for it.
 */
export type Ordering = { expression: Expression; direction: 'ascending' | 'descending' };

/** Sorts by `expression`, smallest first — see {@link Ordering}. */
export const asc = (expression: Expression): Ordering => ({ expression, direction: 'ascending' });

/** Sorts by `expression`, largest first — see {@link Ordering}. */
export const desc = (expression: Expression): Ordering => ({ expression, direction: 'descending' });
