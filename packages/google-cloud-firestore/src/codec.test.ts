import { FieldValue, Firestore } from '@google-cloud/firestore';
import { describe, expect, it } from 'vitest';

import { isDocumentReference, isVectorValue } from './codec.js';

const db = new Firestore({ projectId: 'codec-guard-test' });
const ref = db.doc('col/id');
const vector = FieldValue.vector([1, 2, 3]);

describe('isVectorValue', () => {
  it('returns true for a VectorValue instance', () => {
    expect(isVectorValue(vector)).toBe(true);
  });

  const others: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['array', [1, 2, 3]],
    ['plain object', {}],
    ['string', 'vector'],
    ['DocumentReference', ref],
  ];
  it.each(others)('returns false for %s', (_label, value) => {
    expect(isVectorValue(value)).toBe(false);
  });
});

describe('isDocumentReference', () => {
  it('returns true for a DocumentReference instance', () => {
    expect(isDocumentReference(ref)).toBe(true);
  });

  const others: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['plain object', {}],
    ['string path', 'col/id'],
    ['VectorValue', vector],
  ];
  it.each(others)('returns false for %s', (_label, value) => {
    expect(isDocumentReference(value)).toBe(false);
  });
});
