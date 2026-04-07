import { describe, expectTypeOf, it } from 'vitest';

import { DocRef } from './repository.js';
import {
  array,
  bool,
  bytes,
  docRef,
  double,
  type DocumentSchema,
  type FieldPath,
  type FieldTypeOfPath,
  type FieldValue,
  type FieldValueOfPath,
  GeoPoint,
  geoPoint,
  Increment,
  int64,
  Int64Type,
  LiteralType,
  literal,
  map,
  type MapType,
  optional,
  rootCollection,
  ServerTimestamp,
  string,
  StringType,
  timestamp,
  TimestampType,
  union,
  vector,
  ArrayRemove,
  ArrayUnion,
  nullType,
  nullable,
} from './schema.js';

describe('schema', () => {
  describe('FieldValue', () => {
    it('bool', () => {
      const type = bool();
      expectTypeOf<FieldValue<typeof type, 'read'>>().toEqualTypeOf<boolean>();
      expectTypeOf<FieldValue<typeof type, 'write'>>().toEqualTypeOf<boolean>();
    });

    it('string', () => {
      const type = string();
      expectTypeOf<FieldValue<typeof type, 'read'>>().toEqualTypeOf<string>();
      expectTypeOf<FieldValue<typeof type, 'write'>>().toEqualTypeOf<string>();
    });

    it('int64', () => {
      const type = int64();
      expectTypeOf<FieldValue<typeof type, 'read'>>().toEqualTypeOf<number>();
      expectTypeOf<FieldValue<typeof type, 'write'>>().toEqualTypeOf<number | Increment>();
    });

    it('double', () => {
      const type = double();
      expectTypeOf<FieldValue<typeof type, 'read'>>().toEqualTypeOf<number>();
      expectTypeOf<FieldValue<typeof type, 'write'>>().toEqualTypeOf<number | Increment>();
    });

    it('timestamp', () => {
      const type = timestamp();
      expectTypeOf<FieldValue<typeof type, 'read'>>().toEqualTypeOf<Date>();
      expectTypeOf<FieldValue<typeof type, 'write'>>().toEqualTypeOf<Date | ServerTimestamp>();
    });

    it('docRef', () => {
      const testCollection = rootCollection({
        name: 'TestCollection',
        schema: { name: string(), registeredAt: timestamp() },
      });

      type TestCollection = typeof testCollection;

      const type = docRef(testCollection);
      expectTypeOf<FieldValue<typeof type, 'read'>>().toEqualTypeOf<DocRef<TestCollection>>();
      expectTypeOf<FieldValue<typeof type, 'write'>>().toEqualTypeOf<DocRef<TestCollection>>();
    });

    it('bytes', () => {
      const type = bytes();
      expectTypeOf<FieldValue<typeof type, 'read'>>().toEqualTypeOf<Uint8Array>();
      expectTypeOf<FieldValue<typeof type, 'write'>>().toEqualTypeOf<Uint8Array>();
    });

    it('geoPoint', () => {
      const type = geoPoint();
      expectTypeOf<FieldValue<typeof type, 'read'>>().toEqualTypeOf<GeoPoint>();
      expectTypeOf<FieldValue<typeof type, 'write'>>().toEqualTypeOf<GeoPoint>();
    });

    it('vector', () => {
      const type = vector();
      expectTypeOf<FieldValue<typeof type, 'read'>>().toEqualTypeOf<number[]>();
      expectTypeOf<FieldValue<typeof type, 'write'>>().toEqualTypeOf<number[]>();
    });

    it('null', () => {
      const type = nullType();
      expectTypeOf<FieldValue<typeof type, 'read'>>().toEqualTypeOf<null>();
      expectTypeOf<FieldValue<typeof type, 'write'>>().toEqualTypeOf<null>();
    });

    it('nullable', () => {
      // TODO
    });

    it('map', () => {
      const type = map({ a: string(), b: optional(int64()), c: map({ d: bool() }) });
      expectTypeOf<FieldValue<typeof type, 'read'>>().toEqualTypeOf<{
        a: string;
        b?: number;
        c: { d: boolean };
      }>();
      expectTypeOf<FieldValue<typeof type, 'write'>>().toEqualTypeOf<{
        a: string;
        b?: number | Increment;
        c: { d: boolean };
      }>();
    });

    // TODO: MapType with dynamic keys

    describe('array', () => {
      it('string', () => {
        const type = array(string());
        expectTypeOf<FieldValue<typeof type, 'read'>>().toEqualTypeOf<string[]>();
        expectTypeOf<FieldValue<typeof type, 'write'>>().toEqualTypeOf<
          string[] | ArrayRemove<string> | ArrayUnion<string>
        >();
      });

      it('number (read/write has different type)', () => {
        const type = array(int64());
        expectTypeOf<FieldValue<typeof type, 'read'>>().toEqualTypeOf<number[]>();
        expectTypeOf<FieldValue<typeof type, 'write'>>().toEqualTypeOf<
          // TODO: should contain Increment?
          (number | Increment)[] | ArrayRemove<number> | ArrayUnion<number>
        >();
      });

      // TODO: support tuple
    });

    it('union', () => {
      const type = nullable(union(string(), timestamp()));
      expectTypeOf<FieldValue<typeof type, 'read'>>().toEqualTypeOf<string | Date | null>();
      expectTypeOf<FieldValue<typeof type, 'write'>>().toEqualTypeOf<
        string | Date | ServerTimestamp | null
      >();
    });

    describe('literal', () => {
      it('string literals', () => {
        const type = literal('hello', 'world');
        expectTypeOf<FieldValue<typeof type, 'read'>>().toEqualTypeOf<'hello' | 'world'>();
        expectTypeOf<FieldValue<typeof type, 'write'>>().toEqualTypeOf<'hello' | 'world'>();
      });

      it('number literals', () => {
        const type = literal(1, 2, 3);
        expectTypeOf<FieldValue<typeof type, 'read'>>().toEqualTypeOf<1 | 2 | 3>();
        expectTypeOf<FieldValue<typeof type, 'write'>>().toEqualTypeOf<1 | 2 | 3>();
      });

      it('boolean literals', () => {
        const type = literal(true);
        expectTypeOf<FieldValue<typeof type, 'read'>>().toEqualTypeOf<true>();
        expectTypeOf<FieldValue<typeof type, 'write'>>().toEqualTypeOf<true>();
      });

      it('mixed literals', () => {
        const type = literal('a', 1, true);
        expectTypeOf<FieldValue<typeof type, 'read'>>().toEqualTypeOf<'a' | 1 | true>();
        expectTypeOf<FieldValue<typeof type, 'write'>>().toEqualTypeOf<'a' | 1 | true>();
      });
    });

    // describe('array (compound)', () => {
    //   it('tuple', () => {
    //     type T = {
    //       type: 'array';
    //       headFixedPart: [StringType, BoolType];
    //       dynamicPart: never;
    //       tailFixedPart: [];
    //     };
    //     expectTypeOf<FieldValue<T, 'read'>>().toEqualTypeOf<[string, boolean]>();
    //   });
    //
    //   it('non-empty array', () => {
    //     type T = {
    //       type: 'array';
    //       headFixedPart: [StringType];
    //       dynamicPart: Int64Type;
    //       tailFixedPart: [];
    //     };
    //     expectTypeOf<FieldValue<T, 'read'>>().toEqualTypeOf<[string, ...number[]]>();
    //   });
    // });
    //
  });
});

describe('document', () => {
  describe('FieldPath', () => {
    it('simple', () => {
      const schema = { a: int64(), b: string(), c: array(string()) } satisfies DocumentSchema;
      expectTypeOf<FieldPath<typeof schema>>().toEqualTypeOf<'a' | 'b' | 'c' | '__name__'>();
    });
    it('complex', () => {
      const schema = {
        a: map({ b: string(), c: map({ d: int64(), e: array(map({ f: string() })) }) }),
      } satisfies DocumentSchema;
      expectTypeOf<FieldPath<typeof schema>>().toEqualTypeOf<
        'a' | 'a.b' | 'a.c' | 'a.c.d' | 'a.c.e' | '__name__'
      >();
    });
    it('map fields', () => {
      expectTypeOf<FieldPath<DocumentSchema>>().toEqualTypeOf<string | '__name__'>();
      expectTypeOf<FieldPath<{ a: MapType }>>().toEqualTypeOf<'a' | `a.${string}` | '__name__'>();
    });
  });

  it('FieldValueOfPath', () => {
    const schema = {
      a: int64(),
      b: map({
        c: string(),
        d: map({ e: timestamp() }),
        optional: optional(literal('foo', 'bar')),
        optionalMap: optional(map({ f: string(), g: optional(int64()) })),
      }),
    } satisfies DocumentSchema;
    type Schema = typeof schema;
    expectTypeOf<FieldValueOfPath<Schema, 'a'>>().toEqualTypeOf<number>();
    expectTypeOf<FieldValueOfPath<Schema, 'b.c'>>().toEqualTypeOf<string>();
    expectTypeOf<FieldValueOfPath<Schema, 'b.d'>>().toEqualTypeOf<{ e: Date }>();
    expectTypeOf<FieldValueOfPath<Schema, 'b.d.e'>>().toEqualTypeOf<Date>();
    expectTypeOf<FieldValueOfPath<Schema, 'b.optional'>>().toEqualTypeOf<'foo' | 'bar'>();
    expectTypeOf<FieldValueOfPath<Schema, 'b.optionalMap.f'>>().toEqualTypeOf<string>();
    expectTypeOf<FieldValueOfPath<Schema, 'b.optionalMap.g'>>().toEqualTypeOf<number>();
    expectTypeOf<FieldValueOfPath<Schema, '__name__'>>().toEqualTypeOf<string>();
  });

  it('FieldTypeOfPath', () => {
    const schema = {
      a: int64(),
      b: map({
        c: string(),
        d: map({ e: timestamp() }),
        optional: optional(literal('foo', 'bar')),
        optionalMap: optional(map({ f: string(), g: optional(int64()) })),
      }),
    } satisfies DocumentSchema;
    type Schema = typeof schema;
    expectTypeOf<FieldTypeOfPath<Schema, 'a'>>().toEqualTypeOf<Int64Type>();
    expectTypeOf<FieldTypeOfPath<Schema, 'b.c'>>().toEqualTypeOf<StringType>();
    expectTypeOf<FieldTypeOfPath<Schema, 'b.d'>>().toEqualTypeOf<MapType<{ e: TimestampType }>>();
    expectTypeOf<FieldTypeOfPath<Schema, 'b.d.e'>>().toEqualTypeOf<TimestampType>();
    expectTypeOf<FieldTypeOfPath<Schema, 'b.optional'>>().toExtend<LiteralType<['foo', 'bar']>>();
    expectTypeOf<FieldTypeOfPath<Schema, 'b.optionalMap.f'>>().toEqualTypeOf<StringType>();
    expectTypeOf<FieldTypeOfPath<Schema, 'b.optionalMap.g'>>().toExtend<Int64Type>();
    expectTypeOf<FieldTypeOfPath<Schema, '__name__'>>().toEqualTypeOf<StringType>();
  });
});
