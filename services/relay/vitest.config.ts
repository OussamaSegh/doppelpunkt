import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: '@doppelpunkt/relay', environment: 'node', include: ['test/**/*.test.ts'] },
});
