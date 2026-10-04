import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestPublicUrl } from '@cyber-stray/shared/outbound';
import { sendFeishuMessage } from './lark-sender.js';

const fixture = vi.hoisted(() => ({ config: { feishuWebhook: '', feishu: { pushMode: 'webhook' } } }));
vi.mock('../../config.js', () => ({ getConfig: () => fixture.config }));
vi.mock('@larksuiteoapi/node-sdk', () => ({ createLarkChannel: vi.fn() }));
vi.mock('@cyber-stray/shared/outbound', async (original) => ({ ...await original<object>(), requestPublicUrl: vi.fn() }));

beforeEach(() => {
  vi.mocked(requestPublicUrl).mockReset();
  fixture.config.feishuWebhook = 'https://open.feishu.cn/open-apis/bot/v2/hook/test-hook';
});

describe('飞书 webhook 实际发送边界', () => {
  it('官方 webhook 使用同一出站传输，保留成功和服务端错误语义', async () => {
    vi.mocked(requestPublicUrl).mockResolvedValue({ status: 200, headers: {}, body: Buffer.from('{"code":0}'), url: fixture.config.feishuWebhook });
    await expect(sendFeishuMessage('公开发现')).resolves.toBeUndefined();
    expect(requestPublicUrl).toHaveBeenCalledWith(fixture.config.feishuWebhook, expect.objectContaining({ method: 'POST', maxBytes: 65536 }));
    vi.mocked(requestPublicUrl).mockResolvedValue({ status: 200, headers: {}, body: Buffer.from('{"code":1,"msg":"invalid hook"}'), url: fixture.config.feishuWebhook });
    await expect(sendFeishuMessage('公开发现')).rejects.toThrow('invalid hook');
  });

  it('已持久化的不安全旧配置也不能绕过发送时检查', async () => {
    fixture.config.feishuWebhook = 'http://127.0.0.1/admin';
    await expect(sendFeishuMessage('公开发现')).rejects.toThrow('非公网');
    expect(requestPublicUrl).not.toHaveBeenCalled();
  });
});
