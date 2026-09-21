/**
 * 预算闸单元测试（#265）
 *
 * 契约：
 * - planBudgetYuan：enabled=false 或套餐预算 0 → null（不设闸）；未知套餐按 free
 * - todayLlmCostYuan：只计 kind=llm；当日无文件（ENOENT）= 0；其余读失败抛错
 *   ——「判定不了」绝不折算成「没花钱」（禁兜底红线）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { planBudgetYuan, todayLlmCostYuan } from './budget.js';

describe('预算闸（#265）', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cp-budget-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe('planBudgetYuan', () => {
    const config = { enabled: true, yuanPerPlan: { free: 0.5, pro: 2, byok: 0 } };

    it('各套餐取各自预算；未知套餐按 free（收最紧，与 planLimits 同向）', () => {
      expect(planBudgetYuan(config, 'free')).toBe(0.5);
      expect(planBudgetYuan(config, 'pro')).toBe(2);
      expect(planBudgetYuan(config, 'byok')).toBe(null); // 0 = 不限
      expect(planBudgetYuan(config, 'whatever')).toBe(0.5);
    });

    it('总开关关闭 → 全部 null', () => {
      expect(
        planBudgetYuan({ enabled: false, yuanPerPlan: { free: 0.5, pro: 2, byok: 2 } }, 'free'),
      ).toBe(null);
    });
  });

  describe('todayLlmCostYuan', () => {
    it('只计当日 kind=llm 的行，按单价表折算（deepseek-chat 输入 ¥2/M 输出 ¥8/M）', async () => {
      const usageDir = join(dataDir, 'tenants', 't1', 'usage');
      mkdirSync(usageDir, { recursive: true });
      const row = (inputTokens: number, outputTokens: number): string =>
        JSON.stringify({
          timestamp: '2026-09-19T08:00:00.000Z',
          tenantId: 't1',
          kind: 'llm',
          model: 'deepseek-chat',
          inputTokens,
          outputTokens,
        }) + '\n';
      writeFileSync(
        join(usageDir, 'usage-2026-09-19.jsonl'),
        row(1_000_000, 0) + row(0, 250_000) + JSON.stringify({ timestamp: '2026-09-19T09:00:00.000Z', tenantId: 't1', kind: 'image', model: 'doubao-seedream-5-0-260128', images: 3 }) + '\n',
        'utf-8',
      );
      // ¥2 + ¥2 = ¥4；生图不计入（另有月配额）
      await expect(todayLlmCostYuan(dataDir, 't1', '2026-09-19')).resolves.toBe(4);
    });

    it('跨日隔离：昨天的大额不计入今天', async () => {
      const usageDir = join(dataDir, 'tenants', 't1', 'usage');
      mkdirSync(usageDir, { recursive: true });
      writeFileSync(
        join(usageDir, 'usage-2026-09-18.jsonl'),
        JSON.stringify({ timestamp: '2026-09-18T23:00:00.000Z', tenantId: 't1', kind: 'llm', model: 'deepseek-chat', inputTokens: 10_000_000, outputTokens: 0 }) + '\n',
        'utf-8',
      );
      await expect(todayLlmCostYuan(dataDir, 't1', '2026-09-19')).resolves.toBe(0);
    });

    it('当日无文件（租户未产生用量）= 合法空态 0', async () => {
      await expect(todayLlmCostYuan(dataDir, 't1', '2026-09-19')).resolves.toBe(0);
    });

    it('读失败（usage 路径被文件占用）抛错——不折算成 0', async () => {
      // ENOTDIR：usage 是文件而非目录 → readdir 抛非 ENOENT 错误
      mkdirSync(join(dataDir, 'tenants', 't1'), { recursive: true });
      writeFileSync(join(dataDir, 'tenants', 't1', 'usage'), 'not a dir', 'utf-8');
      await expect(todayLlmCostYuan(dataDir, 't1', '2026-09-19')).rejects.toThrow();
    });
  });
});
