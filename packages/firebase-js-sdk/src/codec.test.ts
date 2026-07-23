import { initializeApp } from '@firebase/app';
import { Bytes, doc, getFirestore } from '@firebase/firestore';
import { array, docRef, int64, map, rootCollection, string } from 'firestore-repository/schema';
import { describe, expect, it } from 'vitest';

import { buildEncodeFilterValue, isBytes, isDocumentReference } from './codec.js';

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

describe('buildEncodeFilterValue', () => {
  const authors = rootCollection({ name: 'Authors', schema: { name: string() } });
  const schema = {
    rank: int64(),
    author: docRef(authors),
    anyRef: docRef(),
    reviewers: array(docRef(authors)),
    meta: map({ editor: docRef(authors) }),
  };
  const encode = buildEncodeFilterValue(schema, db);
  const refDoc = (path: string) => doc(db, path);

  it('passes non-reference operands through', () => {
    expect(encode('rank', '==', 1)).toBe(1);
    expect(encode('rank', 'in', [1, 2])).toStrictEqual([1, 2]);
  });

  it('encodes a reference operand to a DocumentReference (every comparison op)', () => {
    for (const op of ['==', '!=', '<', '<=', '>', '>='] as const) {
      expect(encode('author', op, ['Authors', 'a1'])).toStrictEqual(refDoc('Authors/a1'));
    }
  });

  it('encodes the context-free flavor (__name__ / docRef()) the same way', () => {
    expect(encode('__name__', '==', ['SomeCollection', 'x1'])).toStrictEqual(
      refDoc('SomeCollection/x1'),
    );
    expect(encode('anyRef', '==', ['SomeCollection', 'x1'])).toStrictEqual(
      refDoc('SomeCollection/x1'),
    );
  });

  it('resolves operand arity per operator', () => {
    expect(
      encode('author', 'in', [
        ['Authors', 'a1'],
        ['Authors', 'a2'],
      ]),
    ).toStrictEqual([refDoc('Authors/a1'), refDoc('Authors/a2')]);

    expect(encode('reviewers', 'array-contains', ['Authors', 'a1'])).toStrictEqual(
      refDoc('Authors/a1'),
    );

    expect(
      encode('reviewers', 'array-contains-any', [
        ['Authors', 'a1'],
        ['Authors', 'a2'],
      ]),
    ).toStrictEqual([refDoc('Authors/a1'), refDoc('Authors/a2')]);
  });

  it('recurses into container operands', () => {
    expect(encode('reviewers', '==', [['Authors', 'a1']])).toStrictEqual([refDoc('Authors/a1')]);
    expect(encode('meta', '==', { editor: ['Authors', 'a1'] })).toStrictEqual({
      editor: refDoc('Authors/a1'),
    });
  });

  it('rejects a segment path that does not match the field descriptor', () => {
    expect(() => encode('author', '==', ['Posts', 'p1'])).toThrow();
    expect(() => encode('anyRef', '==', ['odd-length'])).toThrow();
  });
});
