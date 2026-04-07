import { DocRef } from './repository.js';

/**
 * A definition of a Firestore collection
 */
export type Collection<
  Schema extends DocumentSchema = DocumentSchema,
  Parent extends string[] = string[],
> = { name: string; schema: Schema; parent: Parent };

/** A root collection definition (no parent document) */
export type RootCollection<Schema extends DocumentSchema = DocumentSchema> = Collection<Schema, []>;

/** A subcollection definition (nested under a parent document) */
export type SubCollection<
  Schema extends DocumentSchema = DocumentSchema,
  Parent extends [...string[], string] = [...string[], string],
> = Collection<Schema, Parent>;

/** Creates a root collection definition */
export const rootCollection = <Schema extends DocumentSchema>(params: {
  name: string;
  schema: Schema;
}): Collection<Schema, []> => ({ ...params, parent: [] });

/** Creates a subcollection definition */
export const subCollection = <
  Schema extends DocumentSchema,
  const Parent extends [...string[], string],
>(params: {
  name: string;
  schema: Schema;
  parent: Parent;
}): SubCollection<Schema, Parent> => {
  return params;
};

/** A validation schema for document data */
export type DocumentSchema = MapType['fields'];

export type FieldType = { type: string; input: unknown; output: unknown };

export type BoolType = { type: 'bool'; input: boolean; output: boolean };
export type StringType = { type: 'string'; input: string; output: string };
export type Int64Type = { type: 'int64'; input: number | Increment; output: number }; // TODO bigint?
export type DoubleType = { type: 'double'; input: number | Increment; output: number };
export type TimestampType = { type: 'timestamp'; input: Date | ServerTimestamp; output: Date };
export type DocRefType<T extends Collection> = {
  type: 'docRef';
  collection: T;
  input: DocRef<T>;
  output: DocRef<T>;
};
export type BytesType = { type: 'bytes'; input: Uint8Array; output: Uint8Array };
export type GeoPointType = { type: 'geoPoint'; input: GeoPoint; output: GeoPoint };
export type VectorType = { type: 'vector'; input: number[]; output: number[] };
export type NullType = { type: 'null'; input: null; output: null };
export type MapType<T extends MapFields = MapFields> = {
  type: 'map';
  fields: T;
  input: ResolveMapValue<T, 'write'>;
  output: ResolveMapValue<T, 'read'>;
};
export type MapFields = Record<string, FieldType & { [_optional]?: boolean }>;
export type Optional = { [_optional]: true };
export type ArrayType<
  DynamicPart extends FieldType = FieldType,
  HeadFixedPart extends FieldType[] = FieldType[],
  TailFixedPart extends FieldType[] = FieldType[],
> = {
  type: 'array';
  dynamicPart: DynamicPart;
  headFixedPart: HeadFixedPart;
  tailFixedPart: TailFixedPart;
  input: ResolveArrayValue<DynamicPart, 'write'>;
  output: ResolveArrayValue<DynamicPart, 'read'>;
};
export type UnionType<T extends FieldType[] = FieldType[]> = {
  type: 'union';
  elements: T;
  input: ResolveUnionValue<T, 'write'>;
  output: ResolveUnionValue<T, 'read'>;
};
export type LiteralType<T extends (string | number | boolean | null)[]> = {
  type: 'const';
  values: T;
  input: T[number];
  output: T[number];
};

export type FieldValue<T extends FieldType, Mode extends 'read' | 'write'> =
  | (Mode extends 'read' ? T['output'] : never)
  | (Mode extends 'write' ? T['input'] : never);

export type ResolveMapValue<
  T extends MapFields,
  Mode extends 'read' | 'write',
> = MakeSomeFieldsOptional<
  { [K in keyof T]: FieldValue<T[K], Mode> },
  { [K in keyof T]: T[K][typeof _optional] extends true ? K : never }[keyof T]
>;

// TODO: support tuple
export type ResolveArrayValue<T extends FieldType, Mode extends 'read' | 'write'> =
  | FieldValue<T, Mode>[]
  // TODO: disallow this operations when the array has a fixed part
  | (Mode extends 'write'
      ? ArrayRemove<FieldValue<T, 'read'>> | ArrayUnion<FieldValue<T, 'read'>>
      : never);

export type ResolveUnionValue<T extends FieldType[], Mode extends 'read' | 'write'> = {
  [K in keyof T]: T[K] extends FieldType ? FieldValue<T[K], Mode> : never;
}[number & keyof T];

export type GeoPoint = { latitude: number; longitude: number };
export type ArrayRemove<T> = { [serverOperation]: 'arrayRemove'; values: T[] }; // TODO
export type ArrayUnion<T> = { [serverOperation]: 'arrayUnion'; values: T[] }; // TODO
export type ServerTimestamp = { [serverOperation]: 'serverTimestamp' };
export type Increment = { [serverOperation]: 'increment'; amount: number };

type MakeSomeFieldsOptional<T extends Record<string, unknown>, OptFields extends keyof T> = Merge<
  Pick<{ [K in keyof T]?: T[K] }, OptFields> & Omit<T, OptFields>
>;
type Merge<T> = { [K in keyof T]: T[K] };

export const _optional: unique symbol = Symbol();

export const serverOperation: unique symbol = Symbol();

/**
 * Constructs a schema type value without specifying the phantom `input`/`output` fields.
 * Those fields exist only at the type level to carry value type information (valibot-style),
 * so they must not appear in runtime objects. The `as T` cast attaches the phantom types
 * without requiring them in the object literal.
 */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- phantom type cast: input/output fields exist only at type level
const buildType = <T extends FieldType>(v: Omit<T, 'input' | 'output'>): T => v as T;

export const bool = (): BoolType => buildType({ type: 'bool' });
export const string = (): StringType => buildType({ type: 'string' });
export const int64 = (): Int64Type => buildType({ type: 'int64' });
export const double = (): DoubleType => buildType({ type: 'double' });
export const timestamp = (): TimestampType => buildType({ type: 'timestamp' });
export const docRef = <T extends Collection>(collection: T): DocRefType<T> =>
  buildType({ type: 'docRef', collection });
export const bytes = (): BytesType => buildType({ type: 'bytes' });
export const geoPoint = (): GeoPointType => buildType({ type: 'geoPoint' });
export const vector = (): VectorType => buildType({ type: 'vector' });
export const map = <T extends MapType['fields']>(fields: T): MapType<T> =>
  buildType({ type: 'map', fields });
export const array = <T extends FieldType>(elementType: T): ArrayType<T, [], []> =>
  buildType({ type: 'array', dynamicPart: elementType, headFixedPart: [], tailFixedPart: [] });
export const union = <T extends FieldType[]>(...elements: T): UnionType<T> =>
  buildType({ type: 'union', elements });
export const nullType = (): NullType => buildType({ type: 'null' });

export const literal = <const T extends (string | number | boolean | null)[]>(
  ...values: T
): LiteralType<T> => buildType({ type: 'const', values });

export const nullable = <T extends FieldType>(t: T): UnionType<[T, NullType]> =>
  union(t, nullType());

export const optional = <T extends FieldType>(type: T): T & Optional =>
  buildType({ ...type, [_optional]: true });

export const arrayRemove = <T>(...values: T[]): ArrayRemove<T> => ({
  [serverOperation]: 'arrayRemove',
  values,
});

export const arrayUnion = <T>(...values: T[]): ArrayUnion<T> => ({
  [serverOperation]: 'arrayUnion',
  values,
});

export const serverTimestamp = (): ServerTimestamp => ({ [serverOperation]: 'serverTimestamp' });

export const increment = (amount: number): Increment => ({
  [serverOperation]: 'increment',
  amount,
});

/**
 * A type-safe field path of a document
 */
export type FieldPath<T extends DocumentSchema> = MapFieldPath<T> | '__name__';

type MapFieldPath<T extends MapType['fields']> = MapType['fields'] extends T
  ? string // avoid circular deep type instantiation
  : {
      [K in keyof T & string]:
        | K
        | (T[K] extends MapType ? `${K}.${MapFieldPath<T[K]['fields']>}` : never);
    }[keyof T & string];

/**
 * Resolves field value type at the specified path
 * TODO: Field names containing dots are not handled correctly because dots are used as path separators.
 */
export type FieldTypeOfPath<T extends DocumentSchema, U extends FieldPath<T>> = U extends keyof T
  ? // root field
    T[U]
  : U extends `${infer P}.${infer R}`
    ? P extends keyof T
      ? T[P] extends MapType
        ? // expand nested fields P.*
          FieldTypeOfPath<T[P]['fields'], R>
        : never
      : never
    : U extends '__name__'
      ? StringType
      : never;

/**
 * Resolves field value type at the specified path
 */
export type FieldValueOfPath<T extends DocumentSchema, U extends FieldPath<T>> = FieldValue<
  FieldTypeOfPath<T, U>,
  'read'
>;
