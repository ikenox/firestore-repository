import type { DocRef } from '../repository.js';
import {
  type BoolType,
  type Collection,
  type DocFieldPath,
  type DocumentSchema,
  fieldTypeOfPath,
  type FieldTypeOfPath,
  type FieldValue,
  type MapFieldPath,
  type MapFields,
  type MapType,
  type OmitPaths,
  omitPaths,
} from '../schema.js';
import { AggregateWithAlias } from './aggregate.js';
import { field, type Expression, type Field } from './expression.js';
import { Ordering } from './ordering.js';
import {
  type BuildAddFieldsSchema,
  buildAddFieldsSchema,
  type BuildSelectionSchema,
  buildSelectionSchema,
  dropOverriddenSelections,
  type ExpressionWithAlias,
  type Selection,
} from './selection.js';
import type { InputStage, TransformStage } from './stage.js';

/**
 * Runs a pipeline and returns all of its result rows.
 */
export type PipelineQueryExecutor = {
  execute: <Schema extends Fields, Id extends PipelineRowIdentity>(
    _pipeline: Pipeline<Schema, Id>,
  ) => Promise<PipelineResult<Schema, Id>[]>;
};

/**
 * A lazily-built Firestore Pipeline query.
 *
 * **⚠️ Work in progress / unstable.** Pipeline-query support is under active
 * development and incomplete — most stages are still stubs, and the public
 * surface (method names, argument shapes, the `Schema` / `Id` type parameters,
 * result types) is expected to change, likely with breaking changes. Do not
 * rely on it yet.
 *
 * `Schema` is the schema of the document's `data` fields (it changes as stages
 * reshape the document, and `execute()` resolves it into `PipelineResult.data`).
 * `Id` carries the pipeline's **read-identity**: while the stage
 * chain preserves identity it is a source document ref (`DocRef<T>`), and once
 * an identity-breaking stage runs it ratchets to `undefined`. See
 * `docs/pipeline-query-identity-research.md`.
 *
 * - Identity-preserving stages (`where` / `sort` / `limit` / `offset` /
 *   `addFields` / `removeFields` / `unnest`) thread `Id` through unchanged.
 * - Identity-breaking stages (`select` / `distinct` / `aggregate` /
 *   `fullReplaceWith` / `mergeWith`) return `Id = undefined`. Because the
 *   preserving stages thread whatever `Id` they receive, identity never comes
 *   back once dropped.
 */
export class Pipeline<
  Schema extends Fields = Fields,
  Id extends PipelineRowIdentity = PipelineRowIdentity,
> {
  /**
   * Type-level anchor for `Id` (never exists at runtime — `declare` emits
   * nothing). Without it `Id` would appear only in recursive method-return
   * positions, which TypeScript compares coinductively, making every
   * `Pipeline<Schema, *>` mutually assignable — so an identity-dropped
   * pipeline could be assigned to an identity-preserving type and `execute()`
   * would claim an `id` that does not exist at runtime. Anchoring `Id` in a
   * (covariant) property position makes such assignments compile errors.
   */
  declare private readonly _rowIdentity: Id;

  /**
   * The type-erased AST node this builder wraps. The class *has* a node rather
   * than *being* one: `Pipeline` is a single class that can sit anywhere in the
   * chain, but a node is either a source (the head) or a stage — so the class
   * can't structurally be the discriminated {@link PipelineNode} union. Holding
   * a node also keeps the builder (precise `Schema` / `Id`) cleanly separate
   * from the erased AST an executor walks. The intersection pins the node's
   * `schema` to this builder's `Schema` so stage methods stay well-typed.
   */
  constructor(readonly node: PipelineNode & { readonly schema: Schema }) {}

  /**
   * The pipeline's ordered stages, for an executor: the head {@link InputStage},
   * then the {@link TransformStage}s in application order. Walks the `parent`
   * chain (leaf → root); the walk is guaranteed to bottom out at an input stage
   * by {@link PipelineNode}'s types. Output/DML stages will join this
   * decomposition once the node model represents them.
   */
  stages(): PipelineStages {
    const transforms: TransformStage[] = [];
    let node: PipelineNode = this.node;
    while (node.parent !== undefined) {
      transforms.unshift(node.stage);
      node = node.parent;
    }
    return { input: node.stage, transforms };
  }

  /**
   * Filters rows to those where `condition` evaluates to exactly `true`.
   * Identity-preserving; chained `where` stages conjoin (AND). Rows where the
   * condition evaluates to anything else — `false`, `null`, a missing field,
   * a non-boolean — are silently dropped (Firestore's truthy-only semantics).
   */
  where(condition: (field: FieldProvider<Schema>) => Expression<BoolType>): Pipeline<Schema, Id> {
    return new Pipeline<Schema, Id>({
      schema: this.node.schema,
      stage: { kind: 'where', condition: condition(fieldProvider(this.node.schema)) },
      parent: this.node,
    });
  }
  /**
   * Projects the selections into a new document shape, dropping read-identity
   * (`Id = undefined`).
   *
   * `select` genuinely always drops identity here: {@link Selection} excludes
   * the reserved `'__name__'` key, so the one projection that would preserve the
   * row key at runtime (selecting `__name__` un-aliased) is not expressible —
   * the `Id = undefined` result never lies. To keep identity while reshaping,
   * use `addFields` / `removeFields` (they preserve `Id`); `'__name__'` remains
   * usable in `where` / `sort`. See `docs/pipeline-query-identity-research.md`
   * (the fuller "conditionally preserve identity via `__name__`" model, plus
   * `createTime` / `updateTime`, is deferred — see `docs/plan/pipeline-query.md`).
   */
  select<const Selections extends readonly Selection<Schema>[]>(
    selections: (field: FieldProvider<Schema>) => Selections,
  ): Pipeline<BuildSelectionSchema<Schema, Selections>, undefined> {
    const resolved = selections(fieldProvider(this.node.schema));
    return new Pipeline<BuildSelectionSchema<Schema, Selections>, undefined>({
      schema: buildSelectionSchema(this.node.schema, resolved),
      // Resolve last-wins here so the stage carries a conflict-free list that
      // matches the schema (and executors translate it 1:1).
      stage: { kind: 'select', selections: dropOverriddenSelections(resolved) },
      parent: this.node,
    });
  }
  /**
   * Adds the selections on top of the existing fields, keeping read-identity.
   * On name overlap the added field wins; a dotted alias deep-merges into the
   * existing map (both verified against the backend — see
   * {@link BuildAddFieldsSchema}).
   *
   * Aliased expressions only — bare field paths are rejected at the type
   * level (see {@link BuildAddFieldsSchema} for why they are a foot-gun).
   */
  addFields<const Selections extends readonly ExpressionWithAlias[]>(
    fields: (field: FieldProvider<Schema>) => Selections,
  ): Pipeline<BuildAddFieldsSchema<Schema, Selections>, Id> {
    const resolved = fields(fieldProvider(this.node.schema));
    return new Pipeline<BuildAddFieldsSchema<Schema, Selections>, Id>({
      schema: buildAddFieldsSchema(this.node.schema, resolved),
      // Resolve last-wins here so the stage carries a conflict-free list that
      // matches the schema (and executors translate it 1:1).
      stage: { kind: 'addFields', selections: dropOverriddenSelections(resolved) },
      parent: this.node,
    });
  }
  // `MapFieldPath` (data fields only), not `DocFieldPath`: the reserved
  // `'__name__'` key is not a removable data field. At least one field is
  // required (mirrors the SDK's `removeFields(field, ...rest)` signature).
  removeFields<const U extends [MapFieldPath<Schema>, ...MapFieldPath<Schema>[]]>(
    ...fields: U
  ): Pipeline<OmitPaths<Schema, U[number]>, Id> {
    return new Pipeline<OmitPaths<Schema, U[number]>, Id>({
      schema: omitPaths(this.node.schema, fields),
      stage: { kind: 'removeFields', fields },
      parent: this.node,
    });
  }
  sort(orderings: (field: FieldProvider<Schema>) => Ordering[]): Pipeline<Schema, Id> {
    return new Pipeline<Schema, Id>({
      schema: this.node.schema,
      stage: { kind: 'sort', orderings: orderings(fieldProvider(this.node.schema)) },
      parent: this.node,
    });
  }
  limit(_limit: number): Pipeline<Schema, Id> {
    return unimplemented();
  }
  offset(_offset: number): Pipeline<Schema, Id> {
    return unimplemented();
  }
  // TODO
  unnest(..._args: unknown[]): Pipeline<Fields, Id> {
    return unimplemented();
  }
  aggregate(
    _aggreate: (field: FieldProvider<Schema>) => {
      accumulators: AggregateWithAlias[];
      options?: { groupBy: Expression[] };
    },
  ): Pipeline<Fields, undefined> {
    return unimplemented();
  }
  distinct<const Selections extends readonly Selection<Schema>[]>(
    _groups: (field: FieldProvider<Schema>) => Selections,
  ): Pipeline<Fields, undefined> {
    return unimplemented();
  }
  /** `full_replace`: the document becomes the given map value. */
  fullReplaceWith<M extends MapFields>(
    _map: (field: FieldProvider<Schema>) => Expression<MapType<M>>,
  ): Pipeline<M, undefined> {
    return unimplemented();
  }
  // TODO: tighten the return Schema — `overwrite` -> map wins over the existing
  // Schema, `keep` -> existing wins. Left loose for now.
  mergeWith<M extends MapFields>(
    _map: (field: FieldProvider<Schema>) => Expression<MapType<M>>,
    _mode: MergeMode,
  ): Pipeline<Fields, undefined> {
    return unimplemented();
  }
  // TODO
  // union(..._args: unknown[]): Pipeline<Fields> {
  //   return unimplemented();
  // }
  // findNearest(..._args: unknown[]): Pipeline<Schema> {
  //   return unimplemented();
  // }
  // let(..._args: unknown[]): Pipeline<Schema> {
  //   return unimplemented();
  // }
  // search(..._args: unknown[]): Pipeline<Schema> {
  //   return unimplemented();
  // }
  // sample(..._args: unknown[]): Pipeline<Schema> {
  //   return unimplemented();
  // }
  // update(..._args: unknown[]): Pipeline<Schema> {
  //   return unimplemented();
  // }
  // delete(..._args: unknown[]): Pipeline<Schema> {
  //   return unimplemented();
  // }
}

/**
 * A row produced by {@link PipelineQueryExecutor}.
 *
 * `data` is the document's fields resolved from `Schema`. `id` (a source
 * document ref) is present **only when the pipeline preserved read-identity**
 * (`Id` is a `DocRef`, not `undefined`); once an identity-breaking stage has
 * run, `Id` is `undefined` and `id` is absent, so `result.id` becomes a
 * compile-time error. When identified, this mirrors `Doc<T>`.
 */
export type PipelineResult<Schema extends Fields, Id extends PipelineRowIdentity> = {
  data: FieldValue<MapType<Schema>, 'read'>;
} & (Id extends undefined ? unknown : { readonly id: Id });

export type FieldProvider<Schema extends Fields> = <Path extends DocFieldPath<Schema>>(
  path: Path,
) => Field<FieldTypeOfPath<Schema, Path>, Path>;

/**
 * The read-identity a pipeline carries: a source document ref (`DocRef<T>`)
 * while identity is preserved, or `undefined` after an identity-breaking stage.
 */
export type PipelineRowIdentity = DocRef<Collection> | undefined;

/**
 * The methods-free, type-erased "AST node" view of a pipeline, walked by an
 * executor (which reads `schema` / `stage` / `parent` only). A pipeline is a
 * chain of these nodes, and **the head is always an {@link InputStageNode},
 * guaranteed by the types**: following `parent` from any node bottoms out at an
 * input stage, because a {@link TransformStageNode} always has a `parent` while an
 * input stage never does. This makes "a pipeline starts with an input stage"
 * un-representable-otherwise, so executors need no runtime check for it.
 */
export type PipelineNode = InputStageNode | TransformStageNode;

/** The head of a pipeline chain: an input stage, with no parent. */
export type InputStageNode = {
  readonly schema: Fields;
  readonly stage: InputStage;
  readonly parent?: undefined;
};

/** A transformation stage applied to its `parent` node. */
export type TransformStageNode = {
  readonly schema: Fields;
  readonly stage: TransformStage;
  readonly parent: PipelineNode;
};

/**
 * A pipeline's ordered stages (see {@link Pipeline.stages}): the
 * {@link InputStage} head followed by the {@link TransformStage}s in
 * application order.
 */
export type PipelineStages = {
  readonly input: InputStage;
  readonly transforms: readonly TransformStage[];
  // TODO: add `output?: OutputStage` once output/DML stages are in the node model.
};

/**
 * Runtime {@link FieldProvider}: builds a {@link Field} AST node for a path,
 * resolving the field's `type` from `schema` (via {@link fieldTypeOfPath}) so
 * the expression carries a real type descriptor.
 */
const fieldProvider =
  <Schema extends Fields>(schema: Schema): FieldProvider<Schema> =>
  (path) =>
    field(fieldTypeOfPath(schema, path), path);

/**
 * Conflict resolution for `merge` (the merge modes of the Firestore replace-with
 * stage).
 * - `overwrite`: the merged map's values win on overlap (`merge_overwrite_existing`).
 * - `keep`: existing document values win on overlap (`merge_keep_existing`).
 */
export type MergeMode = 'overwrite' | 'keep';

// TODO: placeholder return value used by stage stubs that are not implemented yet.
// Returns a value (not `throw`) so the type tests, which evaluate stage calls at
// runtime via expectTypeOf, do not blow up.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- stub return value
const unimplemented = <T>(): T => undefined as T;

type Fields = DocumentSchema;
