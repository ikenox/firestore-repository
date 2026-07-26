import { describe, expectTypeOf, it } from 'vitest';

import {
  type Aggregated,
  type AggregateMethod,
  type AggregatedValue,
  type Average,
  average,
  type Count,
  count,
  type Sum,
  sum,
} from './aggregate.js';
import { double, map, rootCollection, string } from './schema.js';

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
});
