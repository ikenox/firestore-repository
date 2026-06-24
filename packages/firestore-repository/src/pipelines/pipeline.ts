import type {
  BoolType,
  DocumentSchema,
  FieldPath,
  FieldTypeOfPath,
  OmitPaths,
} from '../schema.js';
import type { Expression, Field } from './expression.js';
import type { BuildSelection, Selection } from './selection.js';
import type { Stage } from './stage.js';

type Fields = DocumentSchema;

export type FieldProvider<Context extends Fields> = <Path extends FieldPath<Context>>(
  path: Path,
) => Field<FieldTypeOfPath<Context, Path>, Path>;

export class Pipeline<Context extends Fields> {
  constructor(
    readonly schema: Context,
    readonly stage: Stage,
    readonly parent?: Pipeline<Fields>,
  ) {}

  where(
    condition: (field: FieldProvider<Context>) => Expression<BoolType>,
  ): Pipeline<Context> {
    return 1 as any;
  }
  select<const Selections extends readonly Selection<Context>[]>(
    selections: (field: FieldProvider<Context>) => Selections,
  ): Pipeline<BuildSelection<Context, Selections>> {
    return 1 as any;
  }
  addFields() {}
  removeFields<const U extends FieldPath<Context>[]>(
    ...fields: U
  ): Pipeline<OmitPaths<Context, U[number]>> {
    return 1 as any;
  }
  aggregate(): Pipeline<Fields> {
    return 1 as any;
  }
  distinct(): Pipeline<Fields> {
    return 1 as any;
  }
}
