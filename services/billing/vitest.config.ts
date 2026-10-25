import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: '@doppelpunkt/billing', environment: 'node', include: ['test/**/*.test.ts'] },
});
