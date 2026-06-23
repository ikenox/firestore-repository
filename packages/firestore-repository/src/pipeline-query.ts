import {
  Collection,
  DocumentSchema,
  FieldPath,
  OmitPaths,
  PickPaths,
} from "./schema.js";

type Fields = DocumentSchema;

export type Stage =
  | { kind: "input" }
  | { kind: "where" }
  | { kind: "select" }
  | { kind: "aggregate" }
  | { kind: "distinct" };

export class PipelineQuery<T extends DocumentSchema> {
  constructor(
    readonly schema: T,
    readonly stage: Stage,
    readonly parent?: PipelineQuery<DocumentSchema>,
  ) {}

  where(): PipelineQuery<T> {
    return 1 as any;
  }
  select<const U extends FieldPath<T>[]>(
    ...fields: U
  ): PipelineQuery<PickPaths<T, U[number]>> {
    return 1 as any;
  }
  addFields() {}
  removeFields<const U extends FieldPath<T>[]>(
    ...fields: U
  ): PipelineQuery<OmitPaths<T, U[number]>> {
    return 1 as any;
  }
  aggregate(): PipelineQuery<DocumentSchema> {
    return 1 as any;
  }
  distinct(): PipelineQuery<DocumentSchema> {
    return 1 as any;
  }
}

export const pipelineQuery = <T extends Collection>(
  collection: T,
): PipelineQuery<T["schema"]> => ({}) as any;
