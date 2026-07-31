import { join, resolve } from "path";

/**
 * agent 数据目录的解析
 *
 * 数据的唯一归属是 `packages/agent/data/`（agent 是唯一写入方，web 只读）。
 * Next.js 的 `process.cwd()` 在 dev 与 build 下都等于包根目录 `packages/web`，
 * 因此 `../agent/data` 可靠。部署时数据盘挂在别处，用 DATA_DIR 覆盖——
 * 与 agent 侧同名，两边可以一起指过去。
 */
export function dataPath(...segments: string[]): string {
  const root = process.env.DATA_DIR ?? resolve(process.cwd(), "../agent/data");
  return join(root, ...segments);
}
