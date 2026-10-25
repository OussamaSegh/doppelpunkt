import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: '@doppelpunkt/ai', environment: 'node', include: ['test/**/*.test.ts'] },
});
