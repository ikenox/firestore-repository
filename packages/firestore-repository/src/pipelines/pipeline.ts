import type {
  BoolType,
  DocumentSchema,
  FieldPath,
  FieldTypeOfPath,
  OmitPaths,
} from "../schema.js";
import type { Expression, Field } from "./expression.js";
import { Ordering } from "./ordering.js";
import type {
  BuildAddFieldsSchema,
  BuildSelectionSchema,
  Selection,
} from "./selection.js";
import type { Stage } from "./stage.js";

type Fields = DocumentSchema;

export type FieldProvider<Context extends Fields> = <
  Path extends FieldPath<Context>,
>(
  path: Path,
) => Field<FieldTypeOfPath<Context, Path>, Path>;

// TODO: placeholder return value used by stage stubs that are not implemented yet.
// Returns a value (not `throw`) so the type tests, which evaluate stage calls at
// runtime via expectTypeOf, do not blow up.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- stub return value
const unimplemented = <T>(): T => undefined as T;

export class Pipeline<Context extends Fields = Fields> {
  constructor(
    readonly schema: Context,
    readonly stage: Stage,
    readonly parent?: Pipeline<Fields>,
  ) {}

  where(
    _condition: (field: FieldProvider<Context>) => Expression<BoolType>,
  ): Pipeline<Context> {
    return unimplemented();
  }
  select<const Selections extends readonly Selection<Context>[]>(
    _selections: (field: FieldProvider<Context>) => Selections,
  ): Pipeline<BuildSelectionSchema<Context, Selections>> {
    return unimplemented();
  }
  addFields<const Selections extends readonly Selection<Context>[]>(
    _fields: (field: FieldProvider<Context>) => Selections,
  ): Pipeline<BuildAddFieldsSchema<Context, Selections>> {
    return unimplemented();
  }
  removeFields<const U extends FieldPath<Context>[]>(
    ..._fields: U
  ): Pipeline<OmitPaths<Context, U[number]>> {
    return unimplemented();
  }
  sort(
    _orderings: (field: FieldProvider<Context>) => Ordering[],
  ): Pipeline<Context> {
    return unimplemented();
  }
  limit(_limit: number): Pipeline<Context> {
    return unimplemented();
  }
  offset(_offset: number): Pipeline<Context> {
    return unimplemented();
  }
  unnest(..._args: unknown[]): Pipeline<Fields> {
    return unimplemented();
  }
  aggregate(..._args: unknown[]): Pipeline<Fields> {
    return unimplemented();
  }
  distinct(..._args: unknown[]): Pipeline<Fields> {
    return unimplemented();
  }
  replaceWith(..._args: unknown[]): Pipeline<Fields> {
    return unimplemented();
  }
  union(..._args: unknown[]): Pipeline<Fields> {
    return unimplemented();
  }
  findNearest(..._args: unknown[]): Pipeline<Context> {
    return unimplemented();
  }
  let(..._args: unknown[]): Pipeline<Context> {
    return unimplemented();
  }
  search(..._args: unknown[]): Pipeline<Context> {
    return unimplemented();
  }
  sample(..._args: unknown[]): Pipeline<Context> {
    return unimplemented();
  }
  update(..._args: unknown[]): Pipeline<Context> {
    return unimplemented();
  }
  delete(..._args: unknown[]): Pipeline<Context> {
    return unimplemented();
  }
}
