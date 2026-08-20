import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

/**
 * web 包测试（#93 起）：纯函数（node env）+ 组件交互（jsdom，按文件
 * `// @vitest-environment jsdom` 声明）。alias `@/*` 与 tsconfig/Next 对齐。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    root: '.',
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
