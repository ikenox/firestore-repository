import type { Offset } from 'firestore-repository/query';

/**
 * Creates an offset constraint
 */
export const offset = (offset: number): Offset => ({ kind: 'offset', offset });
