import {
  bool,
  BoolType,
  Collection,
  DocumentSchema,
  FieldPath,
  FieldType,
  FieldTypeOfPath,
  FieldValue,
  OmitPaths,
  PickPaths,
} from './schema.js';

type Fields = DocumentSchema;

export type Stage =
  | { kind: 'input' }
  | { kind: 'where' }
  | { kind: 'select' }
  | { kind: 'aggregate' }
  | { kind: 'distinct' };

export type FieldProvider<Context extends Fields> = <Path extends FieldPath<Context>>(
  path: Path,
) => Field<FieldTypeOfPath<Context, Path>, Path>;

export type Expression<T extends FieldType> = { kind: 'expression'; type: T; detail: Equal };

export const equal = <T extends Field>(
  field: T,
  value: FieldValue<T['type'], 'read'>,
): Expression<BoolType> => ({
  kind: 'expression',
  type: bool(),
  detail: { kind: 'equal', field, value },
});

export type Equal = { kind: 'equal'; field: Field; value: unknown };

export type Field<T extends FieldType = FieldType, Path extends string = string> = {
  type: T;
  path: Path;
};

export class PipelineQuery<Context extends Fields> {
  constructor(
    readonly schema: Context,
    readonly stage: Stage,
    readonly parent?: PipelineQuery<Fields>,
  ) {}

  where(
    condition?: (field: FieldProvider<Context>) => Expression<BoolType>,
    ...fields: U
  ): PipelineQuery<Context> {
    return 1 as any;
  }
  // TODO support expression
  select<const U extends FieldPath<Context>[]>(
    ...fields: U
  ): PipelineQuery<PickPaths<Context, U[number]>> {
    return 1 as any;
  }
  addFields() {}
  removeFields<const U extends FieldPath<Context>[]>(
    ...fields: U
  ): PipelineQuery<OmitPaths<Context, U[number]>> {
    return 1 as any;
  }
  aggregate(): PipelineQuery<Fields> {
    return 1 as any;
  }
  distinct(): PipelineQuery<Fields> {
    return 1 as any;
  }
}

export const pipelineQuery = <T extends Collection>(collection: T): PipelineQuery<T['schema']> =>
  ({}) as any;
