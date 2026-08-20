/**
 * diary CLI — 睡前任务的短命 worker 入口（#92 日记系统）
 *
 * 用法：
 *   tsx src/worker/diary-cli.ts --tenant <id> --data-dir <dir> --pet-name <名>
 *     [--date YYYY-MM-DD] [--personality <id>] [--diary-style <choice>]
 *     [--push-enabled true] [--secrets-file <path>] [--plan-args <json>]
 *
 * 由控制面调度器在睡眠开始时 spawn（同 runOneWander worker 模式）。
 * 读当天足迹/新兴趣/主人反馈 → 性格化日记 markdown → 落盘 diary/YYYY-MM-DD.md；
 * 同刻生成当晚梦境 → 独立文件 diary/dreams/YYYY-MM-DD.md（#93，result.dreamFile）。
 *
 * 退出码：0 = 完成（或今天无事跳过）；1 = 失败；2 = 参数错误。
 * stdout 一行 JSON（{ ok, tenantId, result }）；失败时 stderr 一行 JSON。
 */

import { readFileSync } from 'fs';
import { isPersonalityId, type PersonalityId } from '@cyber-stray/shared';
import { isDiaryStyleChoice, type DiaryStyleChoice } from '@cyber-stray/shared/diary';
import type { AgentSecrets, PlanExecutionArgs } from '../types.js';
import { runDiaryWorker } from './generate-diary.js';

function parseArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function isTrue(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

async function main(): Promise<void> {
  const tenantId = parseArg('tenant');
  const dataDir = parseArg('data-dir');
  const petName = parseArg('pet-name');

  if (!tenantId || !dataDir || !petName) {
    console.error(
      '用法: tsx src/worker/diary-cli.ts --tenant <id> --data-dir <dir> --pet-name <名> [--date YYYY-MM-DD] [--personality <id>] [--diary-style <choice>] [--push-enabled true]',
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

  // #90 性格：非法值显式失败（禁兜底——不会静默变默认性格）
  const personalityRaw = parseArg('personality');
  let personality: PersonalityId | undefined;
  if (personalityRaw !== undefined) {
    if (!isPersonalityId(personalityRaw)) {
      console.error(JSON.stringify({ ok: false, tenantId, error: `非法性格: ${personalityRaw}` }));
      process.exit(2);
    }
    personality = personalityRaw;
  }

  // #92 日记风格：非法值显式失败
  const styleRaw = parseArg('diary-style');
  let diaryStyle: DiaryStyleChoice | undefined;
  if (styleRaw !== undefined) {
    if (!isDiaryStyleChoice(styleRaw)) {
      console.error(JSON.stringify({ ok: false, tenantId, error: `非法日记风格: ${styleRaw}` }));
      process.exit(2);
    }
    diaryStyle = styleRaw;
  }

  const result = await runDiaryWorker({
    tenantId,
    dataDir,
    petName,
    date: parseArg('date'),
    personality,
    diaryStyle,
    pushEnabled: isTrue(parseArg('push-enabled')),
    secrets,
    planArgs,
  });
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
