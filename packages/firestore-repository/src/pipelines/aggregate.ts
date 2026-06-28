import { FieldType } from '../schema.js';

export type AggregateWithAlias<T extends FieldType = FieldType, Alias extends string = string> = {
  aggregate: Aggregate<T>;
  alias: Alias;
};

export type Aggregate<T extends FieldType> = { type: T };
