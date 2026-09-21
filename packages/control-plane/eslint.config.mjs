import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "no-undef": "off",
    },
  },
  {
    ignores: ["node_modules/", "coverage/"],
  },
  {
    // 分层棘轮门禁（#280/#284/#286/#288/#290 重构轨收官）：接口层不做 I/O。
    // R1-R4 逐文件圈禁已全部完成，规则翻成整个 routes 目录——
    // 此后任何 route 直接 import db / fs / child_process 或用 fetch 一律红。
    // 测试文件排除（fixture 播种合法使用 db，测试不是接口层代码）。
    files: ["src/routes/**"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // 裸名（无 node: 前缀）与带前缀都圈——评审发现裸 `import 'fs'` 可绕过
              group: ["node:fs", "node:fs/*", "fs", "fs/*", "node:child_process", "child_process"],
              message: "接口层禁直接文件/子进程 I/O——收进 src/infra/。",
            },
            {
              group: ["**/db", "**/db/**"],
              message: "接口层禁直接访问数据库——走 services/ 与 src/infra/ repo。",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "接口层禁直接网络调用——收进 src/infra/。" },
      ],
    },
  },
);
