import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    root: '.',
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
