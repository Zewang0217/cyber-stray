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
    // 分层棘轮门禁（#280 R1 / #284 R2 / #286 R3 / #288 R4a）：接口层不做
    // I/O——已分层文件逐一圈禁，全部干净后扩成 src/routes/**。
    files: [
      "src/routes/feedback.ts",
      "src/routes/pets.ts",
      "src/routes/data.ts",
      "src/routes/admin.ts",
      "src/routes/footprint.ts",
      "src/routes/diary.ts",
      "src/routes/events.ts",
      "src/routes/channels.ts",
      "src/routes/pet-assets.ts",
      "src/routes/auth.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:fs", "node:fs/*", "node:child_process"],
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
