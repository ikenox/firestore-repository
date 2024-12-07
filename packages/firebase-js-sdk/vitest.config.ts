import { defineProject, mergeConfig } from 'vitest/config';
import { sharedConfig } from '../../vitest.shared.js';

export default defineProject(mergeConfig(sharedConfig, {}));
