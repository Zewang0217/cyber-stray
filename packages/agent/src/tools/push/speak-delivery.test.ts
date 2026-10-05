import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfig, loadConfig, setTenantContext } from '../../config.js';
import { useTempDataDir } from '../../test/helpers.js';
import { getInterestGraph, _resetInterestGraphCache } from '../../memory/interest-graph.js';
import { findSpeakRecord, runFeedbackWorker } from '../../worker/feedback-cli.js';
import { speak } from './speak.js';
import { todaySpeaksFile } from './push-budget.js';
import { sendFeishuMessage } from './lark-sender.js';

vi.mock('./lark-sender.js', () => ({ sendFeishuMessage: vi.fn().mockResolvedValue('feishu-1') }));

describe('内容交付与反馈', () => {
  let dataDir: string;
  let cleanup: () => void;
  beforeEach(() => {
    vi.mocked(sendFeishuMessage).mockResolvedValue('feishu-1');
    ({ dataDir, cleanup } = useTempDataDir());
    const config = loadConfig(dataDir);
    config.feishuWebhook = '';
    config.larkAppId = '';
    config.larkAppSecret = '';
    config.telegramBotToken = '';
    config.telegramChatId = '';
    setTenantContext({ tenantId: 'delivery-test', dataDir, config });
  });
  afterEach(() => { setTenantContext(null); cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  test('纯 Web Push 内容有稳定 ID，worker 重启后仍能点赞归因', async () => {
    const graph = getInterestGraph();
    graph.addInterest('量子计算', 0.3);
    await graph.persist();
    const result = await speak('量子计算的新发现 https://example.com/quantum', 'share', {
      matchedTopics: ['量子计算'],
    });
    expect(result.contentId).toEqual(expect.any(String));
    const raw = JSON.parse((await readFile(join(dataDir, 'history', todaySpeaksFile()), 'utf8')).trim());
    expect(raw.contentId).toBe(result.contentId);
    _resetInterestGraphCache();
    setTenantContext(null);
    const feedback = await runFeedbackWorker({ dataDir, action: 'feedback', type: 'like',
      messageId: result.contentId, userId: 'delivery-test', petStats: { mood: 'curious', temper: 20 } });
    expect(feedback).toMatchObject({ recorded: true, topicsMatched: true, interestReinforced: true,
      matchedTopics: ['量子计算'] });
  });

  test('历史目录不可写时显式失败，不能把没有落盘的内容报成功', async () => {
    await writeFile(join(dataDir, 'history'), 'not a directory');
    await expect(speak('内容不能丢', 'article')).rejects.toThrow();
  });

  test('内容 ID 与两个渠道 ID 均能反查同一条归因记录', async () => {
    const config = getConfig();
    config.feishu = { pushMode: 'webhook', receiveMode: 'none', chatId: '' };
    config.feishuWebhook = 'https://example.test/hook';
    config.telegramBotToken = 'test-token';
    config.telegramChatId = 'test-chat';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true, result: { message_id: 42 },
    }))));
    const result = await speak('量子计算', 'article', { matchedTopics: ['量子计算'] });
    expect(result.messageId).toBe('feishu-1');
    expect(result.contentId).not.toBe(result.messageId);
    for (const id of [result.contentId!, 'feishu-1', '42']) {
      expect(await findSpeakRecord(dataDir, id)).toMatchObject({ matchedTopics: ['量子计算'] });
    }
  });
});
