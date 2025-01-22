import { describe, expectTypeOf, it } from 'vitest';
import type {
  ArrayRemove,
  ArrayUnion,
  Bytes,
  DocumentData,
  DocumentReference,
  FieldValue,
  GeoPoint,
  Increment,
  MapArrayToWriteValue,
  ServerTimestamp,
  Timestamp,
  ValueType,
  VectorValue,
  WriteDocumentData,
  WriteValue,
} from './document.js';
import type { FieldPath, MapValue } from './document.js';

describe('document', () => {
  describe('FieldPath', () => {
    it('simple', () => {
      expectTypeOf<
        FieldPath<{
          a: number;
          b: string;
          c: string[];
        }>
      >().toEqualTypeOf<'a' | 'b' | 'c' | '__name__'>();
    });
    it('complex', () => {
      expectTypeOf<
        FieldPath<{
          a: { b: string; c: { d: number; e: { f: string }[] } };
        }>
      >().toEqualTypeOf<'a' | 'a.b' | 'a.c' | 'a.c.d' | 'a.c.e' | '__name__'>();
    });
    it('map fields', () => {
      expectTypeOf<FieldPath>().toEqualTypeOf<string | '__name__'>();
      expectTypeOf<FieldPath<{ a: MapValue }>>().toEqualTypeOf<'a' | `a.${string}` | '__name__'>();
    });
  });

  it('WriteValue', () => {
    expectTypeOf<WriteValue<string>>().toEqualTypeOf<string>();
    expectTypeOf<WriteValue<{ a: { b: 123 } }>>().toEqualTypeOf<{ a: { b: 123 } }>();
    expectTypeOf<WriteValue<Timestamp>>().toEqualTypeOf<Date | Timestamp | ServerTimestamp>();
    expectTypeOf<WriteValue<{ a: { b: Timestamp } }>>().toEqualTypeOf<{
      a: { b: Date | Timestamp | ServerTimestamp };
    }>();
    // prevent deep type instantiation
    expectTypeOf<WriteValue<ValueType>>().toEqualTypeOf<WriteValue<ValueType>>();

    // special values
    expectTypeOf<WriteValue<Timestamp>>().toEqualTypeOf<Date | Timestamp | ServerTimestamp>();
    expectTypeOf<WriteValue<number>>().toEqualTypeOf<number | Increment>();
    expectTypeOf<WriteValue<string[]>>().toEqualTypeOf<string[] | ArrayUnion | ArrayRemove>();
    // union
    expectTypeOf<WriteValue<number | string>>().toEqualTypeOf<number | string | Increment>();
    expectTypeOf<WriteValue<string[] | string>>().toEqualTypeOf<
      string[] | string | ArrayUnion | ArrayRemove
    >();
    // cannot increment literal type field
    expectTypeOf<WriteValue<123>>().toEqualTypeOf<123>();
    // cannot remove/add an element to tuple type field
    expectTypeOf<WriteValue<[string, string]>>().toEqualTypeOf<[string, string]>();
  });

  it('MapArrayToWriteValue', () => {
    expectTypeOf<MapArrayToWriteValue<[number, Timestamp]>>().toEqualTypeOf<
      [number | Increment, Timestamp | Date | ServerTimestamp]
    >();
    expectTypeOf<MapArrayToWriteValue<number[]>>().toEqualTypeOf<(number | Increment)[]>();
    expectTypeOf<MapArrayToWriteValue<Timestamp[]>>().toEqualTypeOf<
      (Timestamp | Date | ServerTimestamp)[]
    >();
    expectTypeOf<MapArrayToWriteValue<ValueType[]>>().toEqualTypeOf<WriteValue<ValueType>[]>();
  });

  it('WriteDocumentData', () => {
    expectTypeOf<WriteDocumentData<{ a: string; b: Timestamp }>>().toEqualTypeOf<{
      a: string;
      b: Timestamp | Date | ServerTimestamp;
    }>();
    expectTypeOf<
      WriteDocumentData<{
        a: string;
        b: { c: Timestamp; d: string };
        e: number[];
        f: { g: Timestamp }[];
        h: { i: 'foo'; j: string } | { i: 'bar'; j: number };
      }>
    >().toEqualTypeOf<{
      a: string;
      b: { c: Timestamp | Date | ServerTimestamp; d: string };
      e: (number | Increment)[] | ArrayUnion | ArrayRemove;
      f: { g: Timestamp | Date | ServerTimestamp }[] | ArrayUnion | ArrayRemove;
      h: { i: 'foo'; j: string } | { i: 'bar'; j: number | Increment };
    }>();

    expectTypeOf<
      WriteDocumentData<{
        id: string;
        array: (string | number)[];
        boolean: boolean;
        bytes: Bytes;
        timestamp: Timestamp;
        number: number;
        getPoint: GeoPoint;
        map: { a: number; b: string[] };
        null: null;
        docRef: DocumentReference;
        string: string;
        vector: VectorValue;
      }>
    >().toEqualTypeOf<{
      id: string;
      array: (string | number | Increment)[] | ArrayUnion | ArrayRemove;
      boolean: boolean;
      bytes: Bytes;
      timestamp: Timestamp | Date | ServerTimestamp;
      number: number | Increment;
      getPoint: GeoPoint;
      map: { a: number | Increment; b: string[] | ArrayUnion | ArrayRemove };
      null: null;
      docRef: DocumentReference;
      string: string;
      vector: VectorValue;
    }>();

    // Test general compatibility between WriteDocumentData and DocumentData
    expectTypeOf<DocumentData>().toMatchTypeOf<WriteDocumentData>();
    (<_T extends DocumentData>() => {
      // FIXME this assertion should be passed
      // expectTypeOf<T>().toMatchTypeOf<WriteDocumentData<T>>();
    })();
  });

  it('FieldValue', () => {
    type Document = { a: number; b: { c: string; d: { e: Timestamp }; optional?: 'foo' | 'bar' } };
    expectTypeOf<FieldValue<Document, 'a'>>().toEqualTypeOf<number>();
    expectTypeOf<FieldValue<Document, 'b.c'>>().toEqualTypeOf<string>();
    expectTypeOf<FieldValue<Document, 'b.d'>>().toEqualTypeOf<{ e: Timestamp }>();
    expectTypeOf<FieldValue<Document, 'b.d.e'>>().toEqualTypeOf<Timestamp>();
    expectTypeOf<FieldValue<Document, 'b.optional'>>().toEqualTypeOf<'foo' | 'bar'>();
    expectTypeOf<FieldValue<Document, '__name__'>>().toEqualTypeOf<string>();
  });
});
