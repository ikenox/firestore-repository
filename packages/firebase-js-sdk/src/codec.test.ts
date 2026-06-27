import { initializeApp } from '@firebase/app';
import { Bytes, doc, getFirestore } from '@firebase/firestore';
import { describe, expect, it } from 'vitest';

import { isBytes, isDocumentReference } from './codec.js';

const db = getFirestore(initializeApp({ projectId: 'codec-guard-test' }, 'codec-guard-test'));
const ref = doc(db, 'col/id');
const bytes = Bytes.fromUint8Array(new Uint8Array([1, 2, 3]));

describe('isBytes', () => {
  it('returns true for a Bytes instance', () => {
    expect(isBytes(bytes)).toBe(true);
  });

  const others: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['Uint8Array', new Uint8Array([1, 2, 3])],
    ['plain object', {}],
    ['string', 'bytes'],
    ['DocumentReference', ref],
  ];
  it.each(others)('returns false for %s', (_label, value) => {
    expect(isBytes(value)).toBe(false);
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
    ['Bytes', bytes],
  ];
  it.each(others)('returns false for %s', (_label, value) => {
    expect(isDocumentReference(value)).toBe(false);
  });
});
