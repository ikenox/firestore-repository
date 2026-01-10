import type { Offset } from 'firestore-repository/query';

/**
 * A query offset constraint
 */
export const offset = (offset: number): Offset => ({ kind: 'offset', offset });
