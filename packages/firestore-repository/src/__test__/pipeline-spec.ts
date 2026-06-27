import { describe } from 'vitest';

import { Fields, Pipeline, pipelineQuery } from '../pipelines/index.js';
import { authorsCollection } from './specification.js';

export const definePipelineSpecificationTests = (
  execute: <T extends Fields>(pipeline: Pipeline<T>) => Hoge<T>,
) => {
  describe('pipeline specification', () => {
    describe('expression', () => {
      const q = pipelineQuery(authorsCollection);
      // TODO
    });
  });
};
