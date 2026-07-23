import type { Expression } from './expression.js';

export type Ordering = { expression: Expression; direction: 'ascending' | 'descending' };

export const asc = (expression: Expression): Ordering => ({ expression, direction: 'ascending' });
export const desc = (expression: Expression): Ordering => ({ expression, direction: 'descending' });
