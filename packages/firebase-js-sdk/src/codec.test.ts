import { initializeApp } from '@firebase/app';
import {
  arrayRemove as firestoreArrayRemove,
  arrayUnion as firestoreArrayUnion,
  Bytes,
  doc,
  GeoPoint,
  getFirestore,
  Timestamp,
  vector as firestoreVector,
} from '@firebase/firestore';
import {
  array,
  bool,
  bytes as bytesType,
  docRef,
  type DocFieldPath,
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
  subCollection,
  timestamp,
  union,
  vector as vectorType,
} from 'firestore-repository/schema';
import { arrayRemove, arrayUnion, increment } from 'firestore-repository/server-value';
import { assert, describe, expect, it } from 'vitest';

import {
  dataDecoder,
  cursorValueEncoder,
  filterOperandEncoder,
  dataEncoder,
  isBytes,
  isDocumentReference,
} from './codec.js';

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

describe('filterOperandEncoder', () => {
  const authors = rootCollection({ name: 'Authors', schema: { name: string() } });
  const schema = {
    rank: int64(),
    author: docRef(authors),
    anyRef: docRef(),
    reviewers: array(docRef(authors)),
    meta: map({ editor: docRef(authors) }),
  };
  const products = rootCollection({ name: 'Products', schema });
  const encode = filterOperandEncoder(products, db);
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

  // A `docRef()` DATA field is genuinely context-free — it may hold a
  // reference to any collection — while the reserved key is not: inside a
  // query it is a reference of the collection being queried.
  it('encodes a context-free reference field from any collection', () => {
    expect(encode('anyRef', '==', ['SomeCollection', 'x1'])).toStrictEqual(
      refDoc('SomeCollection/x1'),
    );
  });

  it('encodes the reserved key as a reference of the queried collection', () => {
    expect(encode('__name__', '==', ['Products', 'p1'])).toStrictEqual(refDoc('Products/p1'));
  });

  it('refuses a reserved-key operand addressing another collection', () => {
    // The type already rules this out; the runtime check is what stops a lying
    // assertion from quietly addressing a document that can never match.
    expect(() => encode('__name__', '==', ['SomeCollection', 'x1'])).toThrow(
      /reference path of collection 'Products'/,
    );
    expect(() => encode('__name__', '==', ['Products', 'p1', 'Parts', 'x1'])).toThrow(
      /reference path of collection 'Products'/,
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

  // Built schemas are memoized across calls, and encoding a reference binds the
  // `Firestore` instance into the schema — so the memo has to be keyed by the
  // database as well as the schema. Reusing one schema across databases is what
  // a dropped database key would silently corrupt: the result is a structurally
  // valid reference pointing at the wrong database, not an error.
  describe('encoders stay bound to the database they were built for', () => {
    const otherDb = getFirestore(
      initializeApp({ projectId: 'codec-guard-test-other' }, 'codec-guard-test-other'),
    );

    it('filter operands', () => {
      const encodeOther = filterOperandEncoder(products, otherDb);

      expect(encode('author', '==', ['Authors', 'a1'])).toStrictEqual(refDoc('Authors/a1'));
      expect(encodeOther('author', '==', ['Authors', 'a1'])).toStrictEqual(
        doc(otherDb, 'Authors/a1'),
      );
      // Pins that the assertion above can actually fail. Two references to the
      // same path differ only in the instance they carry, so a comparison that
      // did not look at it would pass whichever database produced them.
      expect(encodeOther('author', '==', ['Authors', 'a1'])).not.toStrictEqual(
        refDoc('Authors/a1'),
      );
    });

    it('document data', () => {
      const docSchema = { author: docRef(authors) };
      const written = { author: ['Authors', 'a1'] };

      expect(dataEncoder(docSchema, db).parse(written)).toStrictEqual({
        author: refDoc('Authors/a1'),
      });
      expect(dataEncoder(docSchema, otherDb).parse(written)).toStrictEqual({
        author: doc(otherDb, 'Authors/a1'),
      });
    });
  });

  // Built schemas are memoized per SCHEMA, and two collections may share one
  // schema object (`{ ...users, name: other }` — what `readme-example` does).
  // Every other field encodes identically under such a pair, so the shared
  // entry is right; the reserved key does not, which is why its encoder is
  // built per collection instead of cached.
  it('stays bound to the collection too, for the reserved key', () => {
    const twin = rootCollection({ name: 'Twin', schema: products.schema });
    const encodeTwin = filterOperandEncoder(twin, db);

    expect(encode('__name__', '==', ['Products', 'p1'])).toStrictEqual(refDoc('Products/p1'));
    expect(encodeTwin('__name__', '==', ['Twin', 't1'])).toStrictEqual(refDoc('Twin/t1'));
    expect(() => encodeTwin('__name__', '==', ['Products', 'p1'])).toThrow(
      /reference path of collection 'Twin'/,
    );
  });
});

describe('numeric descriptors', () => {
  const schema = { count: int64(), score: double(), nested: map({ count: int64() }) };

  it('rejects fractional int64 values when encoding', () => {
    const encode = dataEncoder(schema, db);

    expect(encode.parse({ count: 1, score: 1.5, nested: { count: 2 } })).toStrictEqual({
      count: 1,
      score: 1.5,
      nested: { count: 2 },
    });
    expect(() => encode.parse({ count: 1.5, score: 1.5, nested: { count: 2 } })).toThrow();
    expect(() => encode.parse({ count: 1, score: 1.5, nested: { count: 2.5 } })).toThrow();
  });

  it('rejects fractional int64 values when decoding', () => {
    const decode = dataDecoder(schema);

    expect(decode.parse({ count: 1, score: 1.5, nested: { count: 2 } })).toStrictEqual({
      count: 1,
      score: 1.5,
      nested: { count: 2 },
    });
    expect(() => decode.parse({ count: 1.5, score: 1.5, nested: { count: 2 } })).toThrow();
    expect(() => decode.parse({ count: 1, score: 1.5, nested: { count: 2.5 } })).toThrow();
  });

  it('requires integer increment amounts for int64 fields', () => {
    const encode = dataEncoder(schema, db);

    expect(() =>
      encode.parse({ count: increment(1), score: increment(1.5), nested: { count: 2 } }),
    ).not.toThrow();
    expect(() =>
      encode.parse({ count: increment(1.5), score: increment(1.5), nested: { count: 2 } }),
    ).toThrow();
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
      encoded: Bytes.fromUint8Array(Uint8Array.from([1, 2, 3])),
    },
    geoPoint: {
      descriptor: geoPointType(),
      written: { latitude: 12.3, longitude: 45.6 },
      encoded: new GeoPoint(12.3, 45.6),
    },
    vector: { descriptor: vectorType(), written: [1, 2, 3], encoded: firestoreVector([1, 2, 3]) },
    docRef: {
      descriptor: docRef(authors),
      written: ['Authors', 'a1'],
      encoded: doc(db, 'Authors/a1'),
    },
    map: {
      descriptor: map({ editor: docRef(authors) }),
      written: { editor: ['Authors', 'a1'] },
      encoded: { editor: doc(db, 'Authors/a1') },
    },
    union: {
      descriptor: union(string(), docRef(authors)),
      written: ['Authors', 'a1'],
      encoded: doc(db, 'Authors/a1'),
    },
    // Firestore rejects a nested array itself, but the descriptor is
    // expressible, so the encoder owes it the same element treatment.
    array: {
      descriptor: array(docRef(authors)),
      written: [['Authors', 'a1']],
      encoded: [doc(db, 'Authors/a1')],
    },
    never: { descriptor: neverType(), uninhabited: true },
  };

  describe.each(Object.entries(elementCases))('%s element', (_name, elementCase) => {
    const encode = dataEncoder({ xs: array(elementCase.descriptor) }, db);

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
        xs: firestoreArrayUnion(encoded),
      });
    });

    it('encodes an arrayRemove element identically', () => {
      expect(encode.parse({ xs: arrayRemove(written) })).toStrictEqual({
        xs: firestoreArrayRemove(encoded),
      });
    });
  });

  describe('an element the descriptor does not admit', () => {
    const encode = dataEncoder({ xs: array(docRef(authors)) }, db);
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
    expect(dataDecoder(schema).parse({ xs: [] })).toStrictEqual({ xs: [] });
    expect(() => dataDecoder(schema).parse({ xs: ['a'] })).toThrow();
  });

  it('encodes the empty array and nothing else', () => {
    expect(dataEncoder(schema, db).parse({ xs: [] })).toStrictEqual({ xs: [] });
    expect(() => dataEncoder(schema, db).parse({ xs: ['a'] })).toThrow();
  });
});

describe('cursorValueEncoder', () => {
  // A cursor value is one value of the field the query is ordered by, so it
  // takes that field's descriptor. Only descriptors whose encoded form differs
  // from their plain-JS one can show the difference; the descriptor coverage
  // itself belongs to the write codec, which these delegate to.
  const authors = rootCollection({ name: 'Authors', schema: { name: string() } });
  const when = new Date('2020-01-02T03:04:05.000Z');
  const schema = {
    author: docRef(authors),
    spot: geoPointType(),
    at: timestamp(),
    blob: bytesType(),
    rank: int64(),
    tags: array(string()),
  };
  const products = rootCollection({ name: 'Products', schema });
  const encode = cursorValueEncoder(products, db);

  const cases: [DocFieldPath<typeof schema>, unknown, unknown][] = [
    ['author', ['Authors', 'a1'], doc(db, 'Authors/a1')],
    ['spot', { latitude: 12.3, longitude: 45.6 }, new GeoPoint(12.3, 45.6)],
    ['at', when, Timestamp.fromDate(when)],
    ['blob', Uint8Array.from([1, 2, 3]), Bytes.fromUint8Array(Uint8Array.from([1, 2, 3]))],
    ['rank', 1, 1],
  ];
  it.each(cases)("encodes a %s cursor with that field's descriptor", (path, written, encoded) => {
    expect(encode(path, written, 'collection')).toStrictEqual(encoded);
  });

  // The memo key is the field path, so a second field must not reuse the
  // first one's schema.
  it('keeps one schema per field path', () => {
    expect(encode('author', ['Authors', 'a1'], 'collection')).toStrictEqual(doc(db, 'Authors/a1'));
    expect(encode('spot', { latitude: 1, longitude: 2 }, 'collection')).toStrictEqual(
      new GeoPoint(1, 2),
    );
    expect(encode('author', ['Authors', 'a2'], 'collection')).toStrictEqual(doc(db, 'Authors/a2'));
  });

  it('rejects a value the ordered field does not admit', () => {
    expect(() => encode('author', ['NotAuthors', 'x1'], 'collection')).toThrow();
    expect(() => encode('rank', 'not a number', 'collection')).toThrow();
  });

  // The document key takes a `RefPath` like a `__name__` filter does, and is
  // rendered into the string this SDK wants — which differs per scope.
  // A subcollection, so the two scopes render visibly different strings.
  const parts = subCollection({ name: 'Parts', parent: ['Products'], schema: { n: string() } });
  const encodePart = cursorValueEncoder(parts, db);

  it('renders a __name__ cursor as the document id within a collection', () => {
    expect(encode('__name__', ['Products', 'p1'], 'collection')).toBe('p1');
    expect(encodePart('__name__', ['Products', 'p1', 'Parts', 'x1'], 'collection')).toBe('x1');
  });

  it('renders a __name__ cursor as the full path across a collection group', () => {
    expect(encodePart('__name__', ['Products', 'p1', 'Parts', 'x1'], 'collectionGroup')).toBe(
      'Products/p1/Parts/x1',
    );
  });

  it('refuses a __name__ cursor addressing another collection', () => {
    expect(() => encode('__name__', ['Authors', 'a1'], 'collection')).toThrow(
      /reference path of collection 'Products'/,
    );
  });

  // The forms the SDK itself would take, which the library does not: a bare id
  // cannot name its ancestors, and a `DocumentReference` this SDK rejects.
  it('rejects a __name__ cursor that is not a reference path', () => {
    expect(() => encode('__name__', 'a1', 'collection')).toThrow();
    expect(() => encode('__name__', doc(db, 'Authors/a1'), 'collection')).toThrow();
    expect(() => encode('__name__', ['odd'], 'collection')).toThrow();
  });
});
