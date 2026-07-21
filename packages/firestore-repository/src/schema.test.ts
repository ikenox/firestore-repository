import { describe, expect, expectTypeOf, it } from 'vitest';

import { expectTypedStrictEqual } from './__test__/assertion.js';
import {
  type AnyMapType,
  array,
  type ArrayType,
  bool,
  type BoolType,
  bytes,
  docRef,
  double,
  type DocRefType,
  type RefPath,
  type DoubleType,
  type DocumentSchema,
  type DocFieldPath,
  fieldTypeOfPath,
  type FieldType,
  type FieldTypeOfPath,
  type FieldValue,
  type FieldValueOfPath,
  GeoPoint,
  geoPoint,
  type GeoPointType,
  Increment,
  int64,
  isMapType,
  Int64Type,
  LiteralType,
  literal,
  map,
  type MapType,
  type OmitPaths,
  omitPaths,
  optional,
  type Optional,
  type PickPaths,
  rootCollection,
  subCollection,
  ServerTimestamp,
  string,
  StringType,
  type TailPath,
  timestamp,
  TimestampType,
  union,
  vector,
  ArrayRemove,
  ArrayUnion,
  nullType,
  nullable,
  normalize,
  type Normalize,
  type NullType,
  type UnionType,
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
      expectTypeOf<FieldValue<typeof type, 'read'>>().toEqualTypeOf<RefPath<TestCollection>>();
      expectTypeOf<FieldValue<typeof type, 'read'>>().toEqualTypeOf<['TestCollection', string]>();
      expectTypeOf<FieldValue<typeof type, 'write'>>().toEqualTypeOf<RefPath<TestCollection>>();
    });

    it('docRef (context-free flavor): untyped segment paths both ways', () => {
      const type = docRef();
      expectTypeOf<FieldValue<typeof type, 'read'>>().toEqualTypeOf<string[]>();
      expectTypeOf<FieldValue<typeof type, 'write'>>().toEqualTypeOf<string[]>();
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

      // TODO: support tuple (https://github.com/ikenox/firestore-repository/issues/218)
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
  });

  describe('firestoreType (phantom axis)', () => {
    it('scalar tags', () => {
      const bytesType = bytes();
      const nullT = nullType();
      const vectorT = vector();
      expectTypeOf<StringType['firestoreType']>().toEqualTypeOf<'string'>();
      expectTypeOf<BoolType['firestoreType']>().toEqualTypeOf<'boolean'>();
      expectTypeOf<TimestampType['firestoreType']>().toEqualTypeOf<'timestamp'>();
      expectTypeOf<(typeof bytesType)['firestoreType']>().toEqualTypeOf<'bytes'>();
      expectTypeOf<(typeof nullT)['firestoreType']>().toEqualTypeOf<'null'>();
      expectTypeOf<(typeof vectorT)['firestoreType']>().toEqualTypeOf<'vector'>();
    });

    it('int64/double carry the honest integer|double union', () => {
      expectTypeOf<Int64Type['firestoreType']>().toEqualTypeOf<'integer' | 'double'>();
      expectTypeOf<DoubleType['firestoreType']>().toEqualTypeOf<'integer' | 'double'>();
    });

    it('reference / geopoint tags are flat — the axis exists to distinguish them from their TS representations', () => {
      const authors = rootCollection({ name: 'authors', schema: { name: string() } });
      const ref = docRef(authors);
      expectTypeOf<(typeof ref)['firestoreType']>().toEqualTypeOf<'reference'>();
      expectTypeOf<GeoPointType['firestoreType']>().toEqualTypeOf<'geopoint'>();
    });

    it('literals map to their base tags', () => {
      expectTypeOf<LiteralType<['a', 'b']>['firestoreType']>().toEqualTypeOf<'string'>();
      expectTypeOf<LiteralType<[1, 2]>['firestoreType']>().toEqualTypeOf<'integer' | 'double'>();
      expectTypeOf<LiteralType<[true]>['firestoreType']>().toEqualTypeOf<'boolean'>();
      expectTypeOf<LiteralType<['a', 1, null]>['firestoreType']>().toEqualTypeOf<
        'string' | 'integer' | 'double' | 'null'
      >();
    });

    it('union distributes over member tags', () => {
      const t = nullable(string());
      expectTypeOf<(typeof t)['firestoreType']>().toEqualTypeOf<'string' | 'null'>();
    });

    it('array is the element tags', () => {
      const t = array(string());
      expectTypeOf<(typeof t)['firestoreType']>().toEqualTypeOf<readonly 'string'[]>();
      const u = array(union(string(), double()));
      expectTypeOf<(typeof u)['firestoreType']>().toEqualTypeOf<
        readonly ('string' | 'integer' | 'double')[]
      >();
    });

    it('map is a per-field tag record, all required (presence is the optional axis)', () => {
      const t = map({ age: double(), gender: optional(literal('male', 'female')) });
      expectTypeOf<(typeof t)['firestoreType']>().toEqualTypeOf<{
        age: 'integer' | 'double';
        gender: 'string';
      }>();
    });

    it('the optional marker does not change the tag', () => {
      const t = optional(string());
      expectTypeOf<(typeof t)['firestoreType']>().toEqualTypeOf<'string'>();
    });
  });

  describe('FieldType (closed union)', () => {
    const authors = rootCollection({ name: 'authors', schema: { name: string() } });

    it('every factory-built descriptor is a member of the union', () => {
      // The `FieldType[]` annotation is the assertion: this fails to compile
      // if any factory's return type falls outside the closed union.
      const descriptors: FieldType[] = [
        bool(),
        string(),
        int64(),
        double(),
        timestamp(),
        docRef(authors),
        bytes(),
        geoPoint(),
        vector(),
        nullType(),
        map({ a: string() }),
        array(string()),
        union(string(), nullType()),
        literal('a', 1, true, null),
        optional(string()),
        nullable(map({ deep: array(union(literal(true), double())) })),
      ];
      expect(descriptors).toHaveLength(16);
    });

    it('isMapType narrows exactly the map descriptor', () => {
      expect(isMapType(map({ a: string() }))).toBe(true);
      const nonMaps: FieldType[] = [
        bool(),
        string(),
        int64(),
        double(),
        timestamp(),
        docRef(authors),
        bytes(),
        geoPoint(),
        vector(),
        nullType(),
        array(string()),
        union(string(), nullType()),
        literal('a'),
      ];
      expect(nonMaps.map(isMapType)).toEqual(nonMaps.map(() => false));
      // Pins the compiler-inferred (checked, not asserted) type predicate.
      expectTypeOf(isMapType).guards.toEqualTypeOf<AnyMapType>();
    });
  });

  describe('dotted field names are rejected', () => {
    // Rejected at both layers: the type level (the field's descriptor type
    // becomes `never` via `WithoutDottedFieldNames`) and the runtime level
    // (the factory throws) — hence @ts-expect-error wrapped in toThrow.
    it('map', () => {
      expect(() =>
        // @ts-expect-error a field name containing "." is rejected
        map({ 'a.b': string() }),
      ).toThrow('must not contain "."');
    });

    it('rootCollection', () => {
      expect(() =>
        // @ts-expect-error a field name containing "." is rejected
        rootCollection({ name: 'authors', schema: { 'a.b': string() } }),
      ).toThrow('must not contain "."');
    });

    it('subCollection', () => {
      expect(() =>
        // @ts-expect-error a field name containing "." is rejected
        subCollection({ name: 'posts', schema: { 'a.b': string() }, parent: ['authors'] }),
      ).toThrow('must not contain "."');
    });

    it('a nested map inside a collection schema is covered by the map factory', () => {
      expect(() =>
        rootCollection({
          name: 'authors',
          // @ts-expect-error a nested field name containing "." is rejected
          schema: { profile: map({ 'a.b': string() }) },
        }),
      ).toThrow('must not contain "."');
    });
  });
});

describe('document', () => {
  describe('DocFieldPath', () => {
    it('simple', () => {
      const schema = { a: int64(), b: string(), c: array(string()) } satisfies DocumentSchema;
      expectTypeOf<DocFieldPath<typeof schema>>().toEqualTypeOf<'a' | 'b' | 'c' | '__name__'>();
    });
    it('complex', () => {
      const schema = {
        a: map({ b: string(), c: map({ d: int64(), e: array(map({ f: string() })) }) }),
      } satisfies DocumentSchema;
      expectTypeOf<DocFieldPath<typeof schema>>().toEqualTypeOf<
        'a' | 'a.b' | 'a.c' | 'a.c.d' | 'a.c.e' | '__name__'
      >();
    });
    it('map fields', () => {
      expectTypeOf<DocFieldPath<DocumentSchema>>().toEqualTypeOf<string | '__name__'>();
      expectTypeOf<DocFieldPath<{ a: MapType }>>().toEqualTypeOf<
        'a' | `a.${string}` | '__name__'
      >();
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
    expectTypeOf<FieldValueOfPath<Schema, '__name__'>>().toEqualTypeOf<string[]>();
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
    expectTypeOf<FieldTypeOfPath<Schema, '__name__'>>().toEqualTypeOf<DocRefType<'unknown'>>();
  });

  // Comprehensive runtime tests for `fieldTypeOfPath` — its return type is bridged
  // with a type assertion, so these tests are the safety net that the runtime walk
  // actually mirrors the type-level `FieldTypeOfPath`.
  describe('fieldTypeOfPath', () => {
    const deep = map({ y: string() });
    const nested = map({ x: int64(), deep });
    const schema = {
      s: string(),
      n: double(),
      i: int64(),
      b: bool(),
      t: timestamp(),
      arr: array(string()),
      m: nested,
    } satisfies DocumentSchema;

    it('resolves top-level fields to the exact schema descriptor', () => {
      // Returns the actual descriptor object (reference equality), not a copy.
      expect(fieldTypeOfPath(schema, 's')).toBe(schema.s);
      expect(fieldTypeOfPath(schema, 'n')).toBe(schema.n);
      expect(fieldTypeOfPath(schema, 'i')).toBe(schema.i);
      expect(fieldTypeOfPath(schema, 'b')).toBe(schema.b);
      expect(fieldTypeOfPath(schema, 't')).toBe(schema.t);
      expect(fieldTypeOfPath(schema, 'arr')).toBe(schema.arr);
      expect(fieldTypeOfPath(schema, 'm')).toBe(schema.m);
    });

    it('resolves top-level fields to the matching type', () => {
      expectTypeOf(fieldTypeOfPath(schema, 's')).toEqualTypeOf<StringType>();
      expectTypeOf(fieldTypeOfPath(schema, 'n')).toEqualTypeOf<DoubleType>();
      expectTypeOf(fieldTypeOfPath(schema, 'i')).toEqualTypeOf<Int64Type>();
      expectTypeOf(fieldTypeOfPath(schema, 'b')).toEqualTypeOf<BoolType>();
      expectTypeOf(fieldTypeOfPath(schema, 't')).toEqualTypeOf<TimestampType>();
      expectTypeOf(fieldTypeOfPath(schema, 'arr')).toEqualTypeOf<ArrayType<StringType>>();
    });

    it('resolves nested (dotted) fields', () => {
      expect(fieldTypeOfPath(schema, 'm.x')).toBe(nested.fields.x);
      expect(fieldTypeOfPath(schema, 'm.deep')).toBe(deep);
      expect(fieldTypeOfPath(schema, 'm.deep.y')).toBe(deep.fields.y);

      expectTypeOf(fieldTypeOfPath(schema, 'm.x')).toEqualTypeOf<Int64Type>();
      expectTypeOf(fieldTypeOfPath(schema, 'm.deep')).toEqualTypeOf<typeof deep>();
      expectTypeOf(fieldTypeOfPath(schema, 'm.deep.y')).toEqualTypeOf<StringType>();
    });

    it('resolves paths through an optional map head', () => {
      // `optional(map(...))` is `MapType & Optional` (an intersection, not a
      // wrapper), so it still structurally satisfies the `extends MapType`
      // checks in `MapFieldPath` / `FieldTypeOfPath`, and the runtime walk's
      // `head.fields` access works unchanged.
      const om = optional(map({ z: string() }));
      const s = { om } satisfies DocumentSchema;

      expect(fieldTypeOfPath(s, 'om')).toBe(om);
      expect(fieldTypeOfPath(s, 'om.z')).toBe(om.fields.z);

      expectTypeOf(fieldTypeOfPath(s, 'om')).toEqualTypeOf<typeof om>();
      // NOTE: the leaf resolves to a plain StringType — the parent map's
      // optionality is NOT propagated to descendant paths. A document without
      // `om` simply has no `om.z` field at read time.
      expectTypeOf(fieldTypeOfPath(s, 'om.z')).toEqualTypeOf<StringType>();
    });

    it('resolves the reserved __name__ to the context-free reference descriptor', () => {
      expect(fieldTypeOfPath(schema, '__name__')).toStrictEqual(docRef());
      expectTypeOf(fieldTypeOfPath(schema, '__name__')).toEqualTypeOf<DocRefType<'unknown'>>();
    });

    it('throws for a path that does not exist at runtime (defensive guard)', () => {
      expect(() =>
        // @ts-expect-error -- deliberately invalid path to exercise the runtime guard
        fieldTypeOfPath(schema, 'nope'),
      ).toThrow();
      expect(() =>
        // @ts-expect-error -- deliberately invalid nested path
        fieldTypeOfPath(schema, 'm.nope'),
      ).toThrow();
    });

    it('resolves paths on a wide (unconstrained) DocumentSchema', () => {
      const wide: DocumentSchema = schema;
      expect(fieldTypeOfPath(wide, 's')).toBe(schema.s);
      expect(fieldTypeOfPath(wide, 'm.deep.y')).toBe(deep.fields.y);
    });
  });

  describe('path helpers', () => {
    type Schema = {
      name: StringType;
      profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
      rank: DoubleType;
      tag: ArrayType<StringType>;
    };

    describe('TailPath', () => {
      it('returns never when no path under K exists in P', () => {
        expectTypeOf<TailPath<'profile', 'name'>>().toEqualTypeOf<never>();
        expectTypeOf<TailPath<'profile', never>>().toEqualTypeOf<never>();
        expectTypeOf<TailPath<'profile', 'rank'>>().toEqualTypeOf<never>();
      });

      it('returns the suffix when P starts with `${K}.`', () => {
        expectTypeOf<TailPath<'profile', 'profile.age'>>().toEqualTypeOf<'age'>();
        expectTypeOf<TailPath<'profile', 'profile.x.y'>>().toEqualTypeOf<'x.y'>();
      });

      it('returns the union of suffixes when P is a union', () => {
        expectTypeOf<
          TailPath<'profile', 'name' | 'profile.age' | 'profile.gender' | 'rank'>
        >().toEqualTypeOf<'age' | 'gender'>();
      });

      it('ignores an exact match of K (no trailing `.`)', () => {
        expectTypeOf<TailPath<'profile', 'profile'>>().toEqualTypeOf<never>();
      });
    });

    describe('PickPaths', () => {
      it('picks a single top-level field', () => {
        expectTypeOf<PickPaths<Schema, 'name'>>().toEqualTypeOf<{ name: StringType }>();
      });

      it('picks multiple top-level fields', () => {
        expectTypeOf<PickPaths<Schema, 'name' | 'rank'>>().toEqualTypeOf<{
          name: StringType;
          rank: DoubleType;
        }>();
      });

      it('picks a nested field and shrinks its MapType', () => {
        expectTypeOf<PickPaths<Schema, 'profile.age'>>().toEqualTypeOf<{
          profile: MapType<{ age: DoubleType }>;
        }>();
      });

      it('preserves the Optional marker on a nested MapType', () => {
        type S = { profile: MapType<{ age: DoubleType; gender: StringType }> & Optional };
        expectTypeOf<PickPaths<S, 'profile.age'>>().toEqualTypeOf<{
          profile: MapType<{ age: DoubleType }> & Optional;
        }>();
      });

      it('keeps an entire subtree when the top-level key is selected directly', () => {
        expectTypeOf<PickPaths<Schema, 'profile'>>().toEqualTypeOf<{
          profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
        }>();
      });

      it('returns an empty schema when no path matches', () => {
        // biome-ignore lint/complexity/noBannedTypes: empty type is the expected result
        expectTypeOf<PickPaths<Schema, 'nonexistent'>>().toEqualTypeOf<{}>();
      });

      it('combines top-level and nested paths', () => {
        expectTypeOf<PickPaths<Schema, 'name' | 'profile.age'>>().toEqualTypeOf<{
          name: StringType;
          profile: MapType<{ age: DoubleType }>;
        }>();
      });

      it('merges sibling nested paths into a single MapType', () => {
        expectTypeOf<PickPaths<Schema, 'profile.age' | 'profile.gender'>>().toEqualTypeOf<{
          profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
        }>();
      });

      it('keeps the whole subtree when a key and its nested path are both picked', () => {
        // Selecting the map key directly subsumes the narrower nested path — the
        // whole subtree wins (it is not shrunk down to just `age`).
        expectTypeOf<PickPaths<Schema, 'profile' | 'profile.age'>>().toEqualTypeOf<{
          profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
        }>();
      });
    });

    describe('OmitPaths', () => {
      it('removes a single top-level field', () => {
        expectTypeOf<OmitPaths<Schema, 'name'>>().toEqualTypeOf<{
          profile: MapType<{ age: DoubleType; gender: LiteralType<['male', 'female']> & Optional }>;
          rank: DoubleType;
          tag: ArrayType<StringType>;
        }>();
      });

      it('removes a nested field while preserving the rest of the MapType', () => {
        expectTypeOf<OmitPaths<Schema, 'profile.gender'>>().toEqualTypeOf<{
          name: StringType;
          profile: MapType<{ age: DoubleType }>;
          rank: DoubleType;
          tag: ArrayType<StringType>;
        }>();
      });

      it('preserves the Optional marker when removing a nested field', () => {
        type S = { profile: MapType<{ age: DoubleType; gender: StringType }> & Optional };
        expectTypeOf<OmitPaths<S, 'profile.gender'>>().toEqualTypeOf<{
          profile: MapType<{ age: DoubleType }> & Optional;
        }>();
      });

      it('drops the whole subtree when a top-level key matches exactly', () => {
        expectTypeOf<OmitPaths<Schema, 'profile'>>().toEqualTypeOf<{
          name: StringType;
          rank: DoubleType;
          tag: ArrayType<StringType>;
        }>();
      });

      it('returns the original schema when no path matches', () => {
        expectTypeOf<OmitPaths<Schema, 'nonexistent'>>().toEqualTypeOf<Schema>();
      });

      it('removes both top-level and nested fields at once', () => {
        expectTypeOf<OmitPaths<Schema, 'name' | 'profile.gender'>>().toEqualTypeOf<{
          profile: MapType<{ age: DoubleType }>;
          rank: DoubleType;
          tag: ArrayType<StringType>;
        }>();
      });

      it('drops a map once its last field is removed', () => {
        type S = { name: StringType; profile: MapType<{ age: DoubleType }> };
        expectTypeOf<OmitPaths<S, 'profile.age'>>().toEqualTypeOf<{ name: StringType }>();
      });

      it('drops a map when all of its fields are removed at once', () => {
        expectTypeOf<OmitPaths<Schema, 'profile.age' | 'profile.gender'>>().toEqualTypeOf<{
          name: StringType;
          rank: DoubleType;
          tag: ArrayType<StringType>;
        }>();
      });

      it('removes a deeply nested field while preserving its siblings', () => {
        type S = { a: MapType<{ b: MapType<{ c: DoubleType; d: StringType }> }> };
        expectTypeOf<OmitPaths<S, 'a.b.c'>>().toEqualTypeOf<{
          a: MapType<{ b: MapType<{ d: StringType }> }>;
        }>();
      });

      it('cascades the empty-map drop up through multiple levels', () => {
        type S = { name: StringType; a: MapType<{ b: MapType<{ c: DoubleType }> }> };
        // Removing the only leaf empties `a.b`, which empties `a`, dropping both.
        expectTypeOf<OmitPaths<S, 'a.b.c'>>().toEqualTypeOf<{ name: StringType }>();
      });
    });

    // Runtime mirror of the `OmitPaths` type tests above. Each case asserts one
    // hand-written oracle on both sides (`toStrictEqual` for the runtime value,
    // `expectTypeOf` for the type-level computation) — see "Type-level /
    // runtime mirroring" in docs/coding-guideline.md.
    describe('omitPaths (runtime)', () => {
      const gender = optional(literal('male', 'female'));
      const profile = map({ age: double(), gender });
      const schema = {
        name: string(),
        profile,
        rank: double(),
        tag: array(string()),
      } satisfies DocumentSchema;

      it('removes a single top-level field', () => {
        const oracle = { profile, rank: schema.rank, tag: schema.tag };
        const actual = omitPaths(schema, ['name']);
        expect(actual).toStrictEqual(oracle);
        expectTypeOf(actual).toEqualTypeOf(oracle);
      });

      it('removes a nested field while preserving the rest of the MapType', () => {
        const oracle = {
          name: schema.name,
          profile: map({ age: profile.fields.age }),
          rank: schema.rank,
          tag: schema.tag,
        };
        const actual = omitPaths(schema, ['profile.gender']);
        expect(actual).toStrictEqual(oracle);
        expectTypeOf(actual).toEqualTypeOf(oracle);
      });

      it('preserves the Optional marker when removing a nested field', () => {
        const s = { profile: optional(map({ age: double(), gender: string() })) };
        const oracle = { profile: optional(map({ age: s.profile.fields.age })) };
        const actual = omitPaths(s, ['profile.gender']);
        expect(actual).toStrictEqual(oracle);
        expectTypeOf(actual).toEqualTypeOf(oracle);
      });

      it('drops the whole subtree when a top-level key matches exactly', () => {
        const oracle = { name: schema.name, rank: schema.rank, tag: schema.tag };
        const actual = omitPaths(schema, ['profile']);
        expect(actual).toStrictEqual(oracle);
        expectTypeOf(actual).toEqualTypeOf(oracle);
      });

      it('returns the original schema entries when no path matches', () => {
        const actual = omitPaths(schema, ['nonexistent']);
        expect(actual).toStrictEqual(schema);
        expectTypeOf(actual).toEqualTypeOf(schema);
      });

      it('removes both top-level and nested fields at once', () => {
        const oracle = {
          profile: map({ age: profile.fields.age }),
          rank: schema.rank,
          tag: schema.tag,
        };
        const actual = omitPaths(schema, ['name', 'profile.gender']);
        expect(actual).toStrictEqual(oracle);
        expectTypeOf(actual).toEqualTypeOf(oracle);
      });

      it('drops a map when all of its fields are removed at once', () => {
        const oracle = { name: schema.name, rank: schema.rank, tag: schema.tag };
        const actual = omitPaths(schema, ['profile.age', 'profile.gender']);
        expect(actual).toStrictEqual(oracle);
        expectTypeOf(actual).toEqualTypeOf(oracle);
      });

      it('cascades the empty-map drop up through multiple levels', () => {
        const s = { name: string(), a: map({ b: map({ c: double() }) }) };
        const oracle = { name: s.name };
        const actual = omitPaths(s, ['a.b.c']);
        expect(actual).toStrictEqual(oracle);
        expectTypeOf(actual).toEqualTypeOf(oracle);
      });
    });
  });
});

/**
 * Cases enumerated from the four steps of `Normalize` (flatten / dedup /
 * drop-`never` / unwrap-singleton) and their interactions, not from any
 * particular caller. Every case but the shape anchor is stated as "this
 * spelling IS that canonical spelling": `expectTypedStrictEqual` pins the
 * runtime value and the static type of both sides together, and the anchor
 * below fixes what the canonical spelling itself denotes.
 */
describe('union normalization', () => {
  it('a multi-member list is a UnionType holding the members in order', () => {
    const t = union(string(), int64());
    expect(t).toStrictEqual({ type: 'union', elements: [{ type: 'string' }, { type: 'int64' }] });
    expectTypeOf(t).toEqualTypeOf<UnionType<[StringType, Int64Type]>>();
  });

  describe('1. flatten nested unions', () => {
    it('flattens a nested union in the first position', () => {
      expectTypedStrictEqual(
        union(union(string(), int64()), bool()),
        union(string(), int64(), bool()),
      );
    });

    it('flattens a nested union in a later position', () => {
      expectTypedStrictEqual(
        union(bool(), union(string(), int64())),
        union(bool(), string(), int64()),
      );
    });

    it('flattens every nested union of a list', () => {
      expectTypedStrictEqual(
        union(union(bool(), string()), union(int64(), timestamp())),
        union(bool(), string(), int64(), timestamp()),
      );
    });

    it('flattens through multiple levels of nesting', () => {
      expectTypedStrictEqual(
        union(union(union(string(), int64()), bool()), timestamp()),
        union(string(), int64(), bool(), timestamp()),
      );
    });

    it('keeps a union whose members are not statically known whole', () => {
      // The recursion breaker: the wide `UnionType` has no known member
      // tuple to spread, so it stays a member of the outer union.
      expectTypeOf<Normalize<[UnionType, NullType]>>().toEqualTypeOf<
        UnionType<[UnionType, NullType]>
      >();
    });
  });

  describe('2. dedup members, keeping the first occurrence', () => {
    it('collapses adjacent duplicates', () => {
      expectTypedStrictEqual(union(string(), string(), int64()), union(string(), int64()));
    });

    it('collapses separated duplicates at the FIRST occurrence, preserving order', () => {
      expectTypedStrictEqual(union(string(), int64(), string()), union(string(), int64()));
    });

    it('compares members structurally, not by identity', () => {
      expectTypedStrictEqual(
        union(map({ a: string() }), map({ a: string() }), int64()),
        union(map({ a: string() }), int64()),
      );
    });

    it('distinguishes members differing only in a nested descriptor', () => {
      expectTypedStrictEqual(
        union(map({ a: string() }), map({ a: int64() })),
        union(map({ a: string() }), map({ a: int64() })),
      );
    });
  });

  describe('3. drop `never` members', () => {
    // A `never` member has no runtime value; `undefined` is its runtime
    // encoding (see `stripNull`), which the typed overload cannot express —
    // so the two claims are made side by side here.
    it('drops some-but-not-all `never` members', () => {
      expect(normalize([undefined, string(), undefined, nullType()])).toStrictEqual(
        union(string(), nullType()),
      );
      expectTypeOf<Normalize<[never, StringType, never, NullType]>>().toEqualTypeOf<
        UnionType<[StringType, NullType]>
      >();
    });

    it('leaves a single member bare once the `never`s are dropped', () => {
      expect(normalize([undefined, string()])).toStrictEqual(string());
      expectTypeOf<Normalize<[never, StringType]>>().toEqualTypeOf<StringType>();
    });

    it('has nothing left when every member is `never`', () => {
      expect(() => normalize([undefined, undefined])).toThrow();
      expectTypeOf<Normalize<[never, never]>>().toEqualTypeOf<never>();
    });
  });

  describe('4. unwrap a singleton', () => {
    it('a one-member list IS that member, not a union of one', () => {
      expectTypedStrictEqual(union(string()), string());
    });

    it('an empty list has no descriptor', () => {
      expect(() => union()).toThrow();
      expectTypeOf<Normalize<[]>>().toEqualTypeOf<never>();
    });
  });

  describe('the steps compose', () => {
    it('dedups a duplicate that only flattening brings together', () => {
      expectTypedStrictEqual(union(union(string(), int64()), string()), union(string(), int64()));
    });

    it('unwraps when dedup leaves exactly one member', () => {
      expectTypedStrictEqual(union(string(), string()), string());
    });

    it('unwraps when flattening and dedup together leave one member', () => {
      expectTypedStrictEqual(union(union(string(), string()), string()), string());
    });
  });

  describe('nullable', () => {
    it('adds NullType as the last member', () => {
      expectTypedStrictEqual(nullable(string()), union(string(), nullType()));
    });

    it('is idempotent', () => {
      expectTypedStrictEqual(nullable(nullable(string())), nullable(string()));
    });

    it('collapses to NullType alone when the payload is already null', () => {
      expectTypedStrictEqual(nullable(nullType()), nullType());
    });

    it('flattens the payload union rather than nesting it', () => {
      expectTypedStrictEqual(
        nullable(union(string(), int64())),
        union(string(), int64(), nullType()),
      );
    });
  });
});
