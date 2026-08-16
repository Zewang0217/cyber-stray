/**
 * speak 的 S11 套餐门控测试（日预算 + 推送窗口 + planLimited 落盘）
 *
 * speak() 的渠道投递依赖外部网络，这里 mock lark-sender / telegram，
 * 只验证预算判定与落盘行为。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('./lark-sender.js', () => ({
  sendFeishuMessage: vi.fn().mockResolvedValue('mock-feishu-id'),
}));

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { useTempDataDir } from '../../test/helpers.js';
import { loadConfig, setTenantContext } from '../../config.js';
import { speak } from './speak.js';
import { todaySpeaksFile } from './push-budget.js';
import type { PlanExecutionArgs } from '../../types.js';

function planOf(over: Partial<PlanExecutionArgs> = {}): PlanExecutionArgs {
  return { plan: 'free', pushesPerDay: 0, pushWindowStart: null, pushWindowEnd: null, ...over };
}

describe('speak S11 套餐门控', () => {
  let cleanup: () => void;
  let dataDir: string;

  beforeEach(() => {
    ({ cleanup, dataDir } = useTempDataDir());
  });

  test('预算已满 → 不投递渠道，落盘 planLimited:true', async () => {
    const plan = planOf({ pushesPerDay: 1 });
    const config = loadConfig(dataDir);
    config.feishuWebhook = 'https://example.test/hook';
    config.feishu = { pushMode: 'webhook', receiveMode: 'none', chatId: '' };
    setTenantContext({ tenantId: 't1', dataDir, config: { ...config, plan } });
    try {
      // 预占 1 条今天的记录（文件名与实现同源：本地日期键）
      const historyDir = join(dataDir, 'history');
      await mkdir(historyDir, { recursive: true });
      await writeFile(
        join(historyDir, todaySpeaksFile()),
        JSON.stringify({ content: 'x', timestamp: new Date().toISOString() }) + '\n',
      );

      const { sendFeishuMessage } = await import('./lark-sender.js');
      const feishu = vi.mocked(sendFeishuMessage);
      feishu.mockClear();

      const result = await speak('新发现的文章', 'article');
      expect(result.pushed).toBe(false);
      expect(feishu).not.toHaveBeenCalled();

      const lines = (
        await readFile(join(historyDir, todaySpeaksFile()), 'utf-8')
      )
        .split('\n')
        .filter(Boolean);
      const last = JSON.parse(lines.at(-1) ?? '') as { planLimited?: boolean };
      expect(last.planLimited).toBe(true);
    } finally {
      setTenantContext(null);
      cleanup();
    }
  });

  test('推送窗口外 → 不投递，落盘 planLimited:true', async () => {
    // 窗口 0-0 之外的当前小时必在窗外（窗口 [0,0] 视为全天，所以用 1-2）
    const nowHour = new Date().getHours();
    const inWindow = nowHour === 1 || nowHour === 2;
    const plan = planOf({ plan: 'pro', pushWindowStart: 1, pushWindowEnd: 2 });
    const config = loadConfig(dataDir);
    config.feishuWebhook = 'https://example.test/hook';
    config.feishu = { pushMode: 'webhook', receiveMode: 'none', chatId: '' };
    setTenantContext({ tenantId: 't2', dataDir, config: { ...config, plan } });
    try {
      const result = await speak('窗口测试', 'share');
      if (inWindow) {
        expect(result.pushed).toBe(true);
      } else {
        expect(result.pushed).toBe(false);
        const { sendFeishuMessage } = await import('./lark-sender.js');
        expect(vi.mocked(sendFeishuMessage)).not.toHaveBeenCalled();
      }
    } finally {
      setTenantContext(null);
      cleanup();
    }
  });

  test('预算内 + 窗口内 → 正常投递', async () => {
    const plan = planOf({ plan: 'pro', pushesPerDay: 20 });
    const config = loadConfig(dataDir);
    config.feishuWebhook = 'https://example.test/hook';
    config.feishu = { pushMode: 'webhook', receiveMode: 'none', chatId: '' };
    setTenantContext({ tenantId: 't3', dataDir, config: { ...config, plan } });
    try {
      const result = await speak('正常推送', 'article');
      expect(result.pushed).toBe(true);
      const { sendFeishuMessage } = await import('./lark-sender.js');
      expect(vi.mocked(sendFeishuMessage)).toHaveBeenCalled();
    } finally {
      setTenantContext(null);
      cleanup();
    }
  });

  test('未注入 plan（单用户模式）→ 不设限', async () => {
    const config = loadConfig(dataDir);
    config.feishuWebhook = 'https://example.test/hook';
    config.feishu = { pushMode: 'webhook', receiveMode: 'none', chatId: '' };
    setTenantContext({ tenantId: 't4', dataDir, config });
    try {
      const result = await speak('单用户', 'article');
      expect(result.pushed).toBe(true);
    } finally {
      setTenantContext(null);
      cleanup();
    }
  });
});
