/**
 * worker CLI — 外部进程入口（调度器拉起：`tsx src/worker/cli.ts`）
 *
 * 用法：
 *   tsx src/worker/cli.ts --tenant <id> --data-dir <dir> [--secrets-file <path>]
 *
 * 退出码：0 = 游荡完成；1 = 游荡失败；2 = 参数错误。
 * 输出：stdout 一行 JSON（{ ok, tenantId, result }）；失败时 stderr 一行 JSON。
 *
 * per-tenant secrets 二选一：
 *   - --secrets-file：JSON 文件，键见 AgentSecrets（控制面解密后写入）
 *   - 进程环境变量（单用户模式 / 调度器注入 env）
 */

import { readFileSync } from 'fs';
import { runOneWander } from './run-one-wander.js';
import type { AgentSecrets } from '../types.js';

function parseArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

async function main(): Promise<void> {
  const tenantId = parseArg('tenant');
  const dataDir = parseArg('data-dir');

  if (!tenantId || !dataDir) {
    console.error(
      '用法: tsx src/worker/cli.ts --tenant <id> --data-dir <dir> [--secrets-file <path>]',
    );
    process.exit(2);
  }

  const secretsFile = parseArg('secrets-file');
  let secrets: AgentSecrets | undefined;
  if (secretsFile) {
    secrets = JSON.parse(readFileSync(secretsFile, 'utf-8')) as AgentSecrets;
  }

  const result = await runOneWander({ tenantId, dataDir, secrets });
  console.log(JSON.stringify({ ok: true, tenantId, result }));
  process.exit(0);
}

main().catch((error: unknown) => {
  const tenantId = parseArg('tenant');
  console.error(
    JSON.stringify({ ok: false, tenantId, error: error instanceof Error ? error.message : String(error) }),
  );
  process.exit(1);
});
