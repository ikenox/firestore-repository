import {
  type Query as FirestoreQuery,
  limit as firestoreLimit,
  orderBy as firestoreOrderBy,
  where as firestoreWhere,
  query,
} from '@firebase/firestore';
import type {
  FieldPath,
  Limit,
  OrderBy,
  Query,
  QueryConstraint,
  Where,
  WhereFilterOp,
} from '../query.js';

export const where: Where = <T extends Query>(
  fieldPath: FieldPath<T['collection']>,
  opStr: WhereFilterOp,
  value: unknown,
): QueryConstraint<T> => {
  return (q: FirestoreQuery) => query(q, firestoreWhere(fieldPath, opStr, value));
};

export const orderBy: OrderBy = <T extends Query>(
  field: FieldPath<T['collection']>,
  direction?: 'asc' | 'desc',
): QueryConstraint<T> => {
  return (q) => query(q, firestoreOrderBy(field, direction));
};

export const limit: Limit = (limit) => {
  return (q) => query(q, firestoreLimit(limit));
};
