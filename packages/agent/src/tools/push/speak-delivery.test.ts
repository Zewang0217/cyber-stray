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

  test('SaaS 无绑定渠道时不使用全局凭据，内容仍进入历史', async () => {
    vi.stubEnv('FEISHU_WEBHOOK', 'https://example.test/global-hook');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'global-token');
    vi.stubEnv('TELEGRAM_CHAT_ID', 'global-chat');
    vi.stubEnv('LARK_APP_ID', 'global-app');
    vi.stubEnv('LARK_APP_SECRET', 'global-secret');
    setTenantContext({ tenantId: 'delivery-test', dataDir, config: loadConfig(dataDir) });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await speak('只写入站内历史', 'article');
    expect(result).toMatchObject({ success: true, pushed: false });
    expect(sendFeishuMessage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    const raw = JSON.parse((await readFile(join(dataDir, 'history', todaySpeaksFile()), 'utf8')).trim());
    expect(raw).toMatchObject({ contentId: result.contentId, pushed: false });
  });

  test('SaaS 已绑定飞书 webhook 时在默认模式下发送', async () => {
    setTenantContext({ tenantId: 'delivery-test', dataDir,
      config: loadConfig(dataDir, { feishuWebhook: 'https://example.test/tenant-hook' }) });
    const result = await speak('发送到租户飞书', 'article');
    expect(result).toMatchObject({ success: true, pushed: true, messageId: 'feishu-1' });
    expect(sendFeishuMessage).toHaveBeenCalledWith('发送到租户飞书');
  });

  test('文章标题与本租户质检通过的图鉴 ID 一同落盘，反馈 ID 不变', async () => {
    const memeId = 'aaaaaaaa-0000-0000-0000-000000000001';
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(dataDir, 'meme-assets'));
    await writeFile(join(dataDir, 'meme-assets', 'manifest.json'), JSON.stringify([
      { id: memeId, qcPass: true },
    ]));
    const result = await speak('这里是完整正文，标题不能截首句。', 'article', {
      title: '一条值得细看的发现', memeId,
    });
    const raw = JSON.parse((await readFile(join(dataDir, 'history', todaySpeaksFile()), 'utf8')).trim());
    expect(raw).toMatchObject({ contentId: result.contentId, title: '一条值得细看的发现', memeId });
    expect(await findSpeakRecord(dataDir, result.contentId!)).not.toBeNull();
  });

  test('其他租户或未过质检的图鉴 ID 不能附到文章', async () => {
    const memeId = 'aaaaaaaa-0000-0000-0000-000000000001';
    await expect(speak('正文', 'article', { title: '独立文章标题', memeId })).rejects.toThrow(/不属于当前租户/);
  });

  test('明确配置的飞书渠道发送失败时返回错误并保留历史', async () => {
    setTenantContext({ tenantId: 'delivery-test', dataDir,
      config: loadConfig(dataDir, { larkAppId: 'tenant-app', larkAppSecret: 'tenant-secret' }) });
    vi.mocked(sendFeishuMessage).mockRejectedValueOnce(new Error('未配置 feishu.chatId'));
    const result = await speak('渠道配置不完整', 'article');
    expect(result).toMatchObject({ success: true, pushed: false, error: '飞书: 未配置 feishu.chatId' });
    const raw = JSON.parse((await readFile(join(dataDir, 'history', todaySpeaksFile()), 'utf8')).trim());
    expect(raw).toMatchObject({ contentId: result.contentId, pushed: false });
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
