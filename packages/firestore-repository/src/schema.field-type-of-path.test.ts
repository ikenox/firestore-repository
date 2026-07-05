import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  array,
  type ArrayType,
  bool,
  type BoolType,
  double,
  type DoubleType,
  type DocumentSchema,
  fieldTypeOfPath,
  int64,
  type Int64Type,
  map,
  string,
  type StringType,
  timestamp,
  type TimestampType,
} from './schema.js';

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
    expectTypeOf(fieldTypeOfPath(schema, 'arr')).toEqualTypeOf<ArrayType<StringType, [], []>>();
  });

  it('resolves nested (dotted) fields', () => {
    expect(fieldTypeOfPath(schema, 'm.x')).toBe(nested.fields.x);
    expect(fieldTypeOfPath(schema, 'm.deep')).toBe(deep);
    expect(fieldTypeOfPath(schema, 'm.deep.y')).toBe(deep.fields.y);

    expectTypeOf(fieldTypeOfPath(schema, 'm.x')).toEqualTypeOf<Int64Type>();
    expectTypeOf(fieldTypeOfPath(schema, 'm.deep')).toEqualTypeOf<typeof deep>();
    expectTypeOf(fieldTypeOfPath(schema, 'm.deep.y')).toEqualTypeOf<StringType>();
  });

  it('resolves the reserved __name__ to a StringType', () => {
    expect(fieldTypeOfPath(schema, '__name__')).toStrictEqual(string());
    expectTypeOf(fieldTypeOfPath(schema, '__name__')).toEqualTypeOf<StringType>();
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
