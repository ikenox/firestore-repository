export type Stage =
  | { kind: 'input' }
  | { kind: 'where' }
  | { kind: 'select' }
  | { kind: 'aggregate' }
  | { kind: 'distinct' };
