import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createECDH, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { requestPublicUrl } from '@cyber-stray/shared/outbound';
import { sendPublicNotification } from './send-public-notification.js';

vi.mock('@cyber-stray/shared/outbound', async (original) => ({ ...await original<object>(), requestPublicUrl: vi.fn() }));

beforeEach(() => { vi.restoreAllMocks(); vi.mocked(requestPublicUrl).mockReset(); });

describe('Web Push 实际出站', () => {
  it('加密请求使用钉 IP 传输，禁止让 web-push 自行解析并连接 endpoint', async () => {
    const oldTransport = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({ statusCode: 201, headers: {}, body: '' });
    vi.mocked(requestPublicUrl).mockResolvedValue({ status: 201, headers: {}, body: Buffer.alloc(0), url: 'https://push.example/sub' });
    const receiver = createECDH('prime256v1');
    const keys = { p256dh: receiver.generateKeys().toString('base64url'), auth: randomBytes(16).toString('base64url') };
    await sendPublicNotification('https://push.example/sub', { title: '发现' }, keys);
    expect(oldTransport).not.toHaveBeenCalled();
    expect(requestPublicUrl).toHaveBeenCalledWith('https://push.example/sub', expect.objectContaining({ method: 'POST', body: expect.any(Buffer) }));
  });

  it('保留 410 状态供网关删除失效订阅', async () => {
    vi.mocked(requestPublicUrl).mockResolvedValue({ status: 410, headers: {}, body: Buffer.alloc(0), url: 'https://push.example/sub' });
    const receiver = createECDH('prime256v1');
    const keys = { p256dh: receiver.generateKeys().toString('base64url'), auth: randomBytes(16).toString('base64url') };
    await expect(sendPublicNotification('https://push.example/sub', { title: '发现' }, keys)).rejects.toMatchObject({ statusCode: 410 });
  });
});
