/**
 * X1 信念判定报告（#272 / #302）
 *
 * 汇总每租户：D0（最早 pets.createdAt）、活跃日（activity JSONL）、反馈数
 * （feedback.json 全量），判定 X1 并落报告。只读生产数据，不写租户目录；
 * 报告落 <dataDir>/x1-report.json（同 migration 报告惯例，可重跑）。
 *
 * 用法：bun packages/control-plane/src/metrics/x1-report.ts <dataDir>
 */

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { pets } from '../db/schema.js';
import { tenantDataDir } from '../infra/tenant.js';
import { readTenantActivityDays } from '../infra/tenant-activity.js';
import { computeX1, type X1Result } from './x1.js';

export interface X1TenantReport {
  tenantId: string;
  /** 判定状态：ok = 三路数据齐全可判；error = 某路读失败（详情见 error） */
  status: 'ok' | 'error';
  error?: string;
  /** D0 = 最早领养日（本地日期键）；无宠物 = null（未领养，不判定） */
  adoptedDay: string | null;
  result?: X1Result;
}

export interface X1Report {
  ranAt: string;
  tenants: X1TenantReport[];
}

/** 读租户 feedback.json 的反馈条数；ENOENT = 合法空态返回 0；坏结构抛错（禁兜底） */
export async function readFeedbackCount(tenantDir: string): Promise<number> {
  let raw: string;
  try {
    raw = await readFile(join(tenantDir, 'feedback.json'), 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
  const parsed = JSON.parse(raw) as { feedbacks?: unknown };
  if (!Array.isArray(parsed.feedbacks)) {
    throw new Error('feedback.json 结构非法：feedbacks 不是数组');
  }
  return parsed.feedbacks.length;
}

/** 本地日期键：unix 毫秒 → YYYY-MM-DD（与 activity 落盘同源口径） */
function msToLocalDay(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function buildX1Report(dataDir: string): Promise<X1Report> {
  const db = await getDb(dataDir);
  await runMigrations(dataDir);
  const allPets = await db.select().from(pets);

  // 每租户最早领养时刻 = D0（当前单宠，多宠时取最早）
  const adoptedMs = new Map<string, number>();
  for (const pet of allPets) {
    const prev = adoptedMs.get(pet.tenantId);
    if (prev === undefined || pet.createdAt < prev) adoptedMs.set(pet.tenantId, pet.createdAt);
  }

  const tenantIds = new Set<string>(adoptedMs.keys());
  const tenants: X1TenantReport[] = [];
  for (const tenantId of tenantIds) {
    try {
      const adoptedDay = msToLocalDay(adoptedMs.get(tenantId)!);
      const tenantDir = tenantDataDir(dataDir, tenantId);
      const activityDays = await readTenantActivityDays(tenantDir);
      const feedbackCount = await readFeedbackCount(tenantDir);
      tenants.push({
        tenantId,
        status: 'ok',
        adoptedDay,
        result: computeX1({ adoptedDay, activityDays, feedbackCount }),
      });
    } catch (error) {
      tenants.push({ tenantId, status: 'error', adoptedDay: null, error: String(error) });
    }
  }
  return { ranAt: new Date().toISOString(), tenants };
}

/** 报告的 Markdown 形态（stdout 展示 + #299 快照直接引用） */
export function renderX1Markdown(report: X1Report): string {
  const lines = [
    '# X1 信念判定报告',
    '',
    `生成于 ${report.ranAt}；判据：[D7, D14] 前向窗 ≥1 回访 且 累计 ≥1 反馈（#272）`,
    '',
    '| 租户 | D0 领养日 | 活跃日数 | 反馈数 | 窗内回访 | X1 |',
    '|---|---|---|---|---|---|',
  ];
  for (const t of report.tenants) {
    if (t.status !== 'ok' || !t.result) {
      lines.push(`| ${t.tenantId} | 读取失败：${t.error ?? '未知'} | - | - | - | - |`);
      continue;
    }
    if (!t.adoptedDay) {
      lines.push(`| ${t.tenantId} | 未领养 | - | - | - | - |`);
      continue;
    }
    const r = t.result;
    lines.push(
      `| ${t.tenantId} | ${t.adoptedDay} | ${r.totalActiveDays} | ${r.feedbackCount} | ${r.revisitDaysInWindow.join('、') || '无'} | ${r.x1 ? '✅ 成立' : '❌ 未成立'} |`,
    );
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('用法：bun packages/control-plane/src/metrics/x1-report.ts <dataDir>');
    process.exit(1);
  }
  const report = await buildX1Report(dataDir);
  console.log(renderX1Markdown(report));
  const reportPath = join(dataDir, 'x1-report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');
  console.log(`\n报告已写入 ${reportPath}`);
}

// CLI 入口（被 import 时不执行，供测试/复用）
if (process.argv[1]?.endsWith('x1-report.ts')) {
  await main();
}
