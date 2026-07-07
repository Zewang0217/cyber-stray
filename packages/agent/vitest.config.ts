import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    root: './packages/agent',
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
