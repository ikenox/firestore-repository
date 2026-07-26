import { FieldValue, Firestore, GeoPoint, Timestamp } from '@google-cloud/firestore';
import {
  array,
  bool,
  bytes as bytesType,
  docRef,
  double,
  type FieldType,
  geoPoint as geoPointType,
  int64,
  literal,
  map,
  neverType,
  nullType,
  rootCollection,
  string,
  timestamp,
  union,
  vector as vectorType,
} from 'firestore-repository/schema';
import { arrayRemove, arrayUnion } from 'firestore-repository/server-value';
import { assert, describe, expect, it } from 'vitest';

import {
  buildDecodeSchema,
  buildEncodeFilterValue,
  buildEncodeSchema,
  isDocumentReference,
  isVectorValue,
} from './codec.js';

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

  it('passes non-reference operands through', () => {
    expect(encode('rank', '==', 1)).toBe(1);
    expect(encode('rank', 'in', [1, 2])).toStrictEqual([1, 2]);
  });

  it('encodes a reference operand to a DocumentReference (every comparison op)', () => {
    for (const op of ['==', '!=', '<', '<=', '>', '>='] as const) {
      expect(encode('author', op, ['Authors', 'a1'])).toStrictEqual(db.doc('Authors/a1'));
    }
  });

  it('encodes the context-free flavor (__name__ / docRef()) the same way', () => {
    expect(encode('__name__', '==', ['SomeCollection', 'x1'])).toStrictEqual(
      db.doc('SomeCollection/x1'),
    );
    expect(encode('anyRef', '==', ['SomeCollection', 'x1'])).toStrictEqual(
      db.doc('SomeCollection/x1'),
    );
  });

  it('resolves operand arity per operator', () => {
    expect(
      encode('author', 'in', [
        ['Authors', 'a1'],
        ['Authors', 'a2'],
      ]),
    ).toStrictEqual([db.doc('Authors/a1'), db.doc('Authors/a2')]);

    expect(encode('reviewers', 'array-contains', ['Authors', 'a1'])).toStrictEqual(
      db.doc('Authors/a1'),
    );

    expect(
      encode('reviewers', 'array-contains-any', [
        ['Authors', 'a1'],
        ['Authors', 'a2'],
      ]),
    ).toStrictEqual([db.doc('Authors/a1'), db.doc('Authors/a2')]);
  });

  it('recurses into container operands', () => {
    expect(encode('reviewers', '==', [['Authors', 'a1']])).toStrictEqual([db.doc('Authors/a1')]);
    expect(encode('meta', '==', { editor: ['Authors', 'a1'] })).toStrictEqual({
      editor: db.doc('Authors/a1'),
    });
  });

  it('rejects a segment path that does not match the field descriptor', () => {
    expect(() => encode('author', '==', ['Posts', 'p1'])).toThrow();
    expect(() => encode('anyRef', '==', ['odd-length'])).toThrow();
  });
});

describe('array server operations', () => {
  // A value reaches an array field in one of three forms — a plain array and the
  // two server operations — and ALL of them carry element values, so all three
  // owe the element the same encoding. The table below is the oracle for one
  // element, asserted in each of the three positions; keying it on the
  // descriptor union means a new element descriptor cannot be added without
  // stating what Firestore must receive for it.
  const authors = rootCollection({ name: 'Authors', schema: { name: string() } });
  const when = new Date('2020-01-02T03:04:05.000Z');

  type ElementCase =
    // `written` is what a caller passes, `encoded` what Firestore must receive.
    | { descriptor: FieldType; written: unknown; encoded: unknown }
    // The uninhabited descriptor has no element to encode, so it is exercised
    // through the empty element list instead.
    | { descriptor: FieldType; uninhabited: true };

  const elementCases: Record<FieldType['type'], ElementCase> = {
    string: { descriptor: string(), written: 'a', encoded: 'a' },
    bool: { descriptor: bool(), written: true, encoded: true },
    int64: { descriptor: int64(), written: 1, encoded: 1 },
    double: { descriptor: double(), written: 1.5, encoded: 1.5 },
    null: { descriptor: nullType(), written: null, encoded: null },
    const: { descriptor: literal('foo', 'bar'), written: 'bar', encoded: 'bar' },
    timestamp: { descriptor: timestamp(), written: when, encoded: Timestamp.fromDate(when) },
    bytes: {
      descriptor: bytesType(),
      written: Uint8Array.from([1, 2, 3]),
      encoded: Buffer.from([1, 2, 3]),
    },
    geoPoint: {
      descriptor: geoPointType(),
      written: { latitude: 12.3, longitude: 45.6 },
      encoded: new GeoPoint(12.3, 45.6),
    },
    vector: { descriptor: vectorType(), written: [1, 2, 3], encoded: FieldValue.vector([1, 2, 3]) },
    docRef: {
      descriptor: docRef(authors),
      written: ['Authors', 'a1'],
      encoded: db.doc('Authors/a1'),
    },
    map: {
      descriptor: map({ editor: docRef(authors) }),
      written: { editor: ['Authors', 'a1'] },
      encoded: { editor: db.doc('Authors/a1') },
    },
    union: {
      descriptor: union(string(), docRef(authors)),
      written: ['Authors', 'a1'],
      encoded: db.doc('Authors/a1'),
    },
    // Firestore rejects a nested array itself, but the descriptor is
    // expressible, so the encoder owes it the same element treatment.
    array: {
      descriptor: array(docRef(authors)),
      written: [['Authors', 'a1']],
      encoded: [db.doc('Authors/a1')],
    },
    never: { descriptor: neverType(), uninhabited: true },
  };

  describe.each(Object.entries(elementCases))('%s element', (_name, elementCase) => {
    const encode = buildEncodeSchema({ xs: array(elementCase.descriptor) }, db);

    if ('uninhabited' in elementCase) {
      // Its only inhabitant is the empty list, which the plain form alone can
      // express (the SDK requires a server operation to carry at least one
      // element). What the three forms share is therefore the refusal: no value
      // is an element here, so every non-empty form must be rejected.
      it('admits no element in any of the three forms', () => {
        expect(encode.parse({ xs: [] })).toStrictEqual({ xs: [] });
        expect(() => encode.parse({ xs: ['a'] })).toThrow();
        expect(() => encode.parse({ xs: arrayUnion('a') })).toThrow();
        expect(() => encode.parse({ xs: arrayRemove('a') })).toThrow();
      });
      return;
    }

    const { written, encoded } = elementCase;

    it('encodes a plain array element', () => {
      expect(encode.parse({ xs: [written] })).toStrictEqual({ xs: [encoded] });
    });

    it('encodes an arrayUnion element identically', () => {
      expect(encode.parse({ xs: arrayUnion(written) })).toStrictEqual({
        xs: FieldValue.arrayUnion(encoded),
      });
    });

    it('encodes an arrayRemove element identically', () => {
      expect(encode.parse({ xs: arrayRemove(written) })).toStrictEqual({
        xs: FieldValue.arrayRemove(encoded),
      });
    });
  });

  describe('an element the descriptor does not admit', () => {
    const encode = buildEncodeSchema({ xs: array(docRef(authors)) }, db);
    const bad = ['NotAuthors', 'x1'];

    it('is rejected in all three forms', () => {
      expect(() => encode.parse({ xs: [bad] })).toThrow();
      expect(() => encode.parse({ xs: arrayUnion(bad) })).toThrow();
      expect(() => encode.parse({ xs: arrayRemove(bad) })).toThrow();
    });

    it('is reported with its position in the element list', () => {
      // The element schema is piped rather than parsed inside the transform
      // precisely so this stays a zod issue carrying the element's index.
      const result = encode.safeParse({ xs: arrayUnion(['Authors', 'a1'], bad) });
      assert(!result.success);
      const paths = result.error.issues
        .flatMap((issue) => ('errors' in issue ? issue.errors.flat() : [issue]))
        .map((issue) => issue.path);
      expect(paths).toContainEqual([1]);
    });
  });
});

describe('the uninhabited descriptor', () => {
  // `array(neverType())` is what an empty array constant infers to, and it is
  // the one descriptor whose element schema must reject EVERY value: its only
  // inhabitant is the empty array. Both directions are pinned because the
  // encode and decode switches carry the arm independently.
  const schema = { xs: array(neverType()) };

  it('decodes the empty array and nothing else', () => {
    expect(buildDecodeSchema(schema).parse({ xs: [] })).toStrictEqual({ xs: [] });
    expect(() => buildDecodeSchema(schema).parse({ xs: ['a'] })).toThrow();
  });

  it('encodes the empty array and nothing else', () => {
    expect(buildEncodeSchema(schema, db).parse({ xs: [] })).toStrictEqual({ xs: [] });
    expect(() => buildEncodeSchema(schema, db).parse({ xs: ['a'] })).toThrow();
  });
});
