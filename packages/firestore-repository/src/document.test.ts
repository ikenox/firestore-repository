import { describe, expectTypeOf, it } from 'vitest';
import type {
  FieldValue,
  MapArray,
  Timestamp,
  ValueType,
  WriteModel,
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
    expectTypeOf<WriteValue<Timestamp>>().toEqualTypeOf<Date | Timestamp>();
    expectTypeOf<WriteValue<{ a: { b: Timestamp } }>>().toEqualTypeOf<{
      a: { b: Date | Timestamp };
    }>();
    // prevent deep type instantiation
    expectTypeOf<WriteValue<ValueType>>().toEqualTypeOf<WriteValue<ValueType>>();
  });

  it('MapArray', () => {
    expectTypeOf<MapArray<[number, Timestamp]>>().toEqualTypeOf<[number, Timestamp | Date]>();
    expectTypeOf<MapArray<number[]>>().toEqualTypeOf<number[]>();
    expectTypeOf<MapArray<Timestamp[]>>().toEqualTypeOf<(Timestamp | Date)[]>();
    expectTypeOf<MapArray<ValueType[]>>().toEqualTypeOf<WriteValue<ValueType>[]>();
  });

  it('WriteModel', () => {
    expectTypeOf<WriteModel<{ a: string; b: Timestamp }>>().toEqualTypeOf<{
      a: string;
      b: Timestamp | Date;
    }>();
    expectTypeOf<
      WriteModel<{
        a: string;
        b: { c: Timestamp; d: string };
        e: number[];
        f: { g: Timestamp }[];
        h: { i: 'foo'; j: string } | { i: 'bar'; j: number };
      }>
    >().toEqualTypeOf<{
      a: string;
      b: { c: Timestamp | Date; d: string };
      e: number[];
      f: { g: Timestamp | Date }[];
      h: { i: 'foo'; j: string } | { i: 'bar'; j: number };
    }>();

    expectTypeOf<
      WriteModel<{
        id: string;
        array: (string | number)[];
        boolean: boolean;
        bytes: Uint8Array;
        timestamp: Timestamp;
        number: number;
        getPoint: 'todo';
        map: { a: number; b: string[] };
        nan: 'todo';
        null: null;
        docRef: 'todo';
        string: string;
        vector: 'todo';
      }>
    >().toEqualTypeOf<{
      id: string;
      array: (string | number)[];
      boolean: boolean;
      bytes: Uint8Array;
      timestamp: Timestamp | Date;
      number: number;
      getPoint: 'todo';
      map: { a: number; b: string[] };
      nan: 'todo';
      null: null;
      docRef: 'todo';
      string: string;
      vector: 'todo';
    }>();
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
