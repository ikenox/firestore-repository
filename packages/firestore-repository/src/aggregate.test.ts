import { describe, expectTypeOf, it } from 'vitest';

import {
  type Aggregated,
  type AggregateMethod,
  type AggregatedValue,
  type Average,
  average,
  type Count,
  count,
  type NumericFieldPath,
  type Sum,
  sum,
} from './aggregate.js';
import {
  bool,
  docRef,
  double,
  int64,
  literal,
  map,
  nullable,
  rootCollection,
  string,
  union,
  type DocumentSchema,
} from './schema.js';

describe('Aggregated', () => {
  const authors = rootCollection({
    name: 'Authors',
    schema: { name: string(), profile: map({ age: double() }) },
  });
  type Schema = (typeof authors)['schema'];

  // One row per member of `AggregateMethod`, which is what the value type is
  // keyed on: `average` is the only method Firestore can answer with `null`,
  // because a mean needs a numeric value and the other two define an answer
  // for having none. Pinned live in the spec's empty-result-set case.
  it('resolves each aggregate method to its own value type', () => {
    expectTypeOf<AggregatedValue<Count>>().toEqualTypeOf<number>();
    expectTypeOf<AggregatedValue<Sum<Schema>>>().toEqualTypeOf<number>();
    expectTypeOf<AggregatedValue<Average<Schema>>>().toEqualTypeOf<number | null>();
  });

  it('resolves a spec key by key', () => {
    const spec = {
      n: count(),
      total: sum<Schema>('profile.age'),
      avg: average<Schema>('profile.age'),
    };
    expectTypeOf<Aggregated<typeof spec>>().toEqualTypeOf<{
      n: number;
      total: number;
      avg: number | null;
    }>();
  });

  // A key whose method is not statically known has to take the widest answer
  // of the members it could be — understating it would hand back a `number`
  // for something that can arrive as `null`.
  it('widens a key whose method is not statically known', () => {
    expectTypeOf<AggregatedValue<AggregateMethod<Schema>>>().toEqualTypeOf<number | null>();
  });

  it('restricts sum and average to numeric field paths', () => {
    const posts = rootCollection({
      name: 'Posts',
      schema: {
        title: string(),
        published: bool(),
        rank: int64(),
        rating: double(),
        nullableRank: nullable(int64()),
        mixedNumber: union(int64(), double()),
        status: literal('draft', 'published'),
        author: docRef(authors),
        meta: map({ views: int64(), label: string(), maybeScore: nullable(double()) }),
      },
    });
    type PostSchema = (typeof posts)['schema'];

    expectTypeOf<NumericFieldPath<PostSchema>>().toEqualTypeOf<
      'rank' | 'rating' | 'nullableRank' | 'mixedNumber' | 'meta.views' | 'meta.maybeScore'
    >();

    sum<PostSchema>('rank');
    sum<PostSchema>('rating');
    sum<PostSchema>('nullableRank');
    sum<PostSchema>('mixedNumber');
    sum<PostSchema>('meta.views');
    average<PostSchema>('meta.maybeScore');

    // @ts-expect-error string fields are not valid numeric aggregate paths
    sum<PostSchema>('title');
    // @ts-expect-error booleans are not valid numeric aggregate paths
    average<PostSchema>('published');
    // @ts-expect-error literal unions are not valid numeric aggregate paths
    sum<PostSchema>('status');
    // @ts-expect-error document references are not valid numeric aggregate paths
    average<PostSchema>('author');
    // @ts-expect-error maps themselves are not valid numeric aggregate paths
    sum<PostSchema>('meta');
    // @ts-expect-error nested non-numeric fields are not valid numeric aggregate paths
    average<PostSchema>('meta.label');
    // @ts-expect-error the document key is not a numeric aggregate path
    sum<PostSchema>('__name__');
  });

  it('keeps aggregate paths wide for unconstrained schemas', () => {
    expectTypeOf<NumericFieldPath<DocumentSchema>>().toEqualTypeOf<string>();
    sum('anything');
    average('anything');
  });
});
