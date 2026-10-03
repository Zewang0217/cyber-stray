/**
 * 证据快照报告 CLI（#299）
 *
 * 用法：bun packages/control-plane/src/metrics/snapshot-report.ts <dataDir>
 * 输出：Markdown 到 stdout + JSON 落 <dataDir>/snapshot-report.json
 * （#274 放行 ≥2 周后跑第一次正式快照；此前可随时空跑验证管线）。
 */

import { writeFile } from 'fs/promises';
import { join } from 'path';
import { getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { pets } from '../db/schema.js';
import { listTenants } from '../infra/tenant-access.js';
import { collectTenantSnapshot, renderTenantMarkdown, type EvidenceReport, type TenantSnapshot } from './snapshot.js';

export async function buildEvidenceReport(dataDir: string): Promise<EvidenceReport> {
  const db = await getDb(dataDir);
  await runMigrations(dataDir);
  const allPets = await db.select().from(pets);
  // 租户全集 = tenants 表（含无宠物注册租户——空态可见，避免「沉默消失」）
  const allTenants = await listTenants(dataDir);

  // 每租户最早领养时刻 = D0（当前单宠，多宠取最早）；无宠物 = null
  const adoptedMs = new Map<string, number>();
  for (const pet of allPets) {
    const prev = adoptedMs.get(pet.tenantId);
    if (prev === undefined || pet.createdAt < prev) adoptedMs.set(pet.tenantId, pet.createdAt);
  }

  const tenants: TenantSnapshot[] = [];
  for (const tenant of allTenants) {
    const tenantId = tenant.id;
    const ms = adoptedMs.get(tenantId) ?? null;
    try {
      tenants.push(await collectTenantSnapshot(dataDir, tenantId, ms));
    } catch (error) {
      tenants.push({
        tenantId,
        status: 'error',
        error: String(error),
        adoptedDay: null,
        activityDays: [],
        lastActiveDay: null,
        x1: null,
        feedback: { total: 0, like: 0, dislike: 0, boost: 0 },
        speaks: { total: 0, pushed: 0, gated: 0, firstDay: null, lastDay: null },
        interest: { snapshots: 0, first: null, last: null },
        llmInputTokens: 0,
        llmOutputTokens: 0,
        imageCount: 0,
      });
    }
  }
  return { ranAt: new Date().toISOString(), tenants };
}

export function renderReportMarkdown(report: EvidenceReport): string {
  const head = [
    '# 运营与进化证据快照',
    '',
    `生成于 ${report.ranAt}；判据见 #272（X1）/ #299（证据面）`,
    '',
  ];
  return head.join('\n') + report.tenants.map(renderTenantMarkdown).join('\n\n') + '\n';
}

async function main(): Promise<void> {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('用法：bun packages/control-plane/src/metrics/snapshot-report.ts <dataDir>');
    process.exit(1);
  }
  const report = await buildEvidenceReport(dataDir);
  console.log(renderReportMarkdown(report));
  const reportPath = join(dataDir, 'snapshot-report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');
  console.log(`\n报告已写入 ${reportPath}`);
}

// CLI 入口（被 import 时不执行）
if (process.argv[1]?.endsWith('snapshot-report.ts')) {
  await main();
}
