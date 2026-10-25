import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: '@doppelpunkt/license', environment: 'node', include: ['test/**/*.test.ts'] },
});
