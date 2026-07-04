import type { DocRef } from '../repository.js';
import type {
  BoolType,
  Collection,
  DocumentSchema,
  DocFieldPath,
  FieldTypeOfPath,
  FieldValue,
  MapFields,
  MapType,
  OmitPaths,
} from '../schema.js';
import { AggregateWithAlias } from './aggregate.js';
import type { Expression, Field } from './expression.js';
import { Ordering } from './ordering.js';
import type { BuildAddFieldsSchema, BuildSelectionSchema, Selection } from './selection.js';
import type { Stage } from './stage.js';

/**
 * A lazily-built Firestore Pipeline query.
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
  constructor(
    readonly schema: Schema,
    readonly stage: Stage,
    readonly parent?: Pipeline<Fields>,
  ) {}

  where(_condition: (field: FieldProvider<Schema>) => Expression<BoolType>): Pipeline<Schema, Id> {
    return unimplemented();
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
  select<Selections extends readonly Selection<Schema>[]>(
    _selections: (field: FieldProvider<Schema>) => Selections,
  ): Pipeline<BuildSelectionSchema<Schema, Selections>, undefined> {
    return unimplemented();
  }
  addFields<Selections extends readonly Selection<Schema>[]>(
    _fields: (field: FieldProvider<Schema>) => Selections,
  ): Pipeline<BuildAddFieldsSchema<Schema, Selections>, Id> {
    return unimplemented();
  }
  removeFields<const U extends DocFieldPath<Schema>[]>(
    ..._fields: U
  ): Pipeline<OmitPaths<Schema, U[number]>, Id> {
    return unimplemented();
  }
  sort(_orderings: (field: FieldProvider<Schema>) => Ordering[]): Pipeline<Schema, Id> {
    return unimplemented();
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
  distinct<Selections extends readonly Selection<Schema>[]>(
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
  /** Run the pipeline and return its result rows. */
  execute(): Promise<PipelineResult<Schema, Id>[]> {
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
 * A row produced by {@link Pipeline.execute}.
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
