/**
 * worker CLI — 外部进程入口（调度器拉起：`tsx src/worker/cli.ts`）
 *
 * 用法：
 *   tsx src/worker/cli.ts --tenant <id> --data-dir <dir> --pet-state <JSON> [--secrets-file <path>]
 *
 * 退出码：0 = 游荡完成；1 = 游荡失败；2 = 参数错误。
 * 输出：stdout 一行 JSON（{ ok, tenantId, result }）；失败时 stderr 一行 JSON。
 *
 * per-tenant secrets 二选一：
 *   - --secrets-file：JSON 文件，键见 AgentSecrets（控制面解密后写入）
 *   - 进程环境变量（单用户模式 / 调度器注入 env）
 */

import { readFileSync } from 'fs';
import { initLogger } from '../logger.js';
import { runOneWander } from './run-one-wander.js';
import { isPersonalityId, parseCatchphraseList, type Catchphrase, type PersonalityId } from '@cyber-stray/shared';
import { parsePetStats, type PetStats } from '@cyber-stray/shared/pet-stats';
import type { AgentSecrets, PlanExecutionArgs } from '../types.js';

function parseArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

async function main(): Promise<void> {
  // #122：worker 日志落盘（agent logger 只写文件；不初始化则日志全丢）
  initLogger();

  const tenantId = parseArg('tenant');
  const dataDir = parseArg('data-dir');

  if (!tenantId || !dataDir) {
    console.error(
      '用法: tsx src/worker/cli.ts --tenant <id> --data-dir <dir> --pet-state <JSON> [--secrets-file <path>] [--personality <id>]',
    );
    process.exit(2);
  }

  // ADR-0013 注入：宠物数值真相源在 CP pets 表，调度器必传——缺参/形状非法
  // 显式失败（exit 2），绝不回退 state.json 陈旧副本（#173/#213 的根因）
  const petStats = parsePetStateArg(parseArg('pet-state'));
  if (petStats === null) {
    console.error(
      JSON.stringify({ ok: false, tenantId, error: '--pet-state 缺失或形状非法（须为 {energy,boredom,mood,temper} JSON）' }),
    );
    process.exit(2);
  }

  const secretsFile = parseArg('secrets-file');
  let secrets: AgentSecrets | undefined;
  if (secretsFile) {
    secrets = JSON.parse(readFileSync(secretsFile, 'utf-8')) as AgentSecrets;
  }

  const planArgsRaw = parseArg('plan-args');
  let planArgs: PlanExecutionArgs | undefined;
  if (planArgsRaw) {
    planArgs = JSON.parse(planArgsRaw) as PlanExecutionArgs;
  }

  // #90 性格：控制面注入；非法值显式失败（禁兜底——不会静默变默认性格）
  const personalityRaw = parseArg('personality');
  let personality: PersonalityId | undefined;
  if (personalityRaw !== undefined) {
    if (!isPersonalityId(personalityRaw)) {
      console.error(JSON.stringify({ ok: false, tenantId, error: `非法性格: ${personalityRaw}` }));
      process.exit(2);
    }
    personality = personalityRaw;
  }

  // #114 口头禅：控制面注入 JSON（pets.catchphrases 列原样）；非法值显式失败
  const catchphrasesRaw = parseArg('catchphrases');
  let catchphrases: Catchphrase[] | undefined;
  if (catchphrasesRaw !== undefined) {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(catchphrasesRaw);
    } catch {
      console.error(JSON.stringify({ ok: false, tenantId, error: '--catchphrases 须为 JSON 数组' }));
      process.exit(2);
    }
    const parsed = parseCatchphraseList(parsedJson);
    if (typeof parsed === 'string') {
      console.error(JSON.stringify({ ok: false, tenantId, error: parsed }));
      process.exit(2);
    }
    catchphrases = parsed;
  }

  const result = await runOneWander({ tenantId, dataDir, secrets, planArgs, personality, catchphrases, petStats });
  console.log(JSON.stringify({ ok: true, tenantId, result }));
  process.exit(0);
}

/** JSON.parse 失败返回 null（交给统一判非法，不在此抛） */
function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * 解析 --pet-state 注入参数；缺失/形状非法返回 null（导出以覆盖 CLI 边界
 * 测试——评审 P0-1 教训：跨进程字符串边界是类型系统盲区，必须直测）。
 */
export function parsePetStateArg(raw: string | undefined): PetStats | null {
  if (raw === undefined) return null;
  return parsePetStats(safeJsonParse(raw));
}

// 直接执行（非被 import）时跑 main（同 feedback-cli 守卫模式；guard 使
// parsePetStateArg 可被测试导入）
if (process.argv[1]?.endsWith('worker/cli.ts')) {
  main().catch((error: unknown) => {
    const tenantId = parseArg('tenant');
    console.error(
      JSON.stringify({ ok: false, tenantId, error: error instanceof Error ? error.message : String(error) }),
    );
    process.exit(1);
  });
}
