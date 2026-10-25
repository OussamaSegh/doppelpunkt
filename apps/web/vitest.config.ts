import { defineProject } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { workspaceAliases } from './vite.config';

export default defineProject({
  plugins: [react()],
  resolve: { alias: workspaceAliases },
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
