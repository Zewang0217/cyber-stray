import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageApi } from './api.js';
import type { SendMessageResult } from './api.js';

function mockFetch(response: Partial<Response> & { json: () => Promise<unknown> }) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

function okResponse(data: unknown) {
  return {
    ok: true,
    json: async () => data,
  };
}

function errorResponse(status: number, data: unknown) {
  return {
    ok: false,
    status,
    json: async () => data,
  };
}

describe('MessageApi', () => {
  let api: MessageApi;
  let getToken: ReturnType<typeof vi.fn>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getToken = vi.fn().mockResolvedValue('tok-api-test');
    api = new MessageApi(getToken);
    fetchSpy = vi.fn().mockResolvedValue(okResponse({ id: 'msg-1', timestamp: '2025-01-01T00:00:00Z' }));
    vi.stubGlobal('fetch', fetchSpy);
  });

  it('sendC2CText posts correct body', async () => {
    await api.sendC2CText('user-openid-123', 'Hello C2C');

    const callUrl = fetchSpy.mock.calls[0]?.[0] as string;
    const callOptions = fetchSpy.mock.calls[0]?.[1] as { body: string };

    expect(callUrl).toContain('/v2/users/user-openid-123/messages');
    const body = JSON.parse(callOptions.body) as Record<string, unknown>;
    expect(body.content).toBe('Hello C2C');
    expect(body.msg_type).toBe(0);
  });

  it('sendC2CMarkdown posts msg_type 2', async () => {
    await api.sendC2CMarkdown('user-openid-456', '# Markdown');

    const callOptions = fetchSpy.mock.calls[0]?.[1] as { body: string };
    const body = JSON.parse(callOptions.body) as Record<string, unknown>;
    expect(body.msg_type).toBe(2);
    expect(body.markdown).toEqual({ content: '# Markdown' });
  });

  it('sendGroupText posts correct group endpoint', async () => {
    await api.sendGroupText('group-openid-789', 'Hello Group');

    const callUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(callUrl).toContain('/v2/groups/group-openid-789/messages');
    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as { body: string }).body) as Record<string, unknown>;
    expect(body.msg_type).toBe(0);
    expect(body.content).toBe('Hello Group');
  });

  it('sendGroupMarkdown posts markdown to group', async () => {
    await api.sendGroupMarkdown('group-openid-abc', '**bold**');

    const callUrl = fetchSpy.mock.calls[0]?.[0] as string;
    const callOptions = fetchSpy.mock.calls[0]?.[1] as { body: string };
    expect(callUrl).toContain('/v2/groups/group-openid-abc/messages');
    const body = JSON.parse(callOptions.body) as Record<string, unknown>;
    expect(body.msg_type).toBe(2);
    expect(body.markdown).toEqual({ content: '**bold**' });
  });

  it('includes QQBot auth header', async () => {
    await api.sendC2CText('user-x', 'hi');

    const callOptions = fetchSpy.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(callOptions.headers['Authorization']).toBe('QQBot tok-api-test');
  });

  it('returns message id and timestamp on success', async () => {
    fetchSpy.mockResolvedValue(okResponse({ id: 'msg-42', timestamp: '2025-06-01T12:00:00Z' }));

    const result = await api.sendC2CText('user-x', 'test');
    expect(result).toEqual({ id: 'msg-42', timestamp: '2025-06-01T12:00:00Z' });
  });

  it('returns defaults when response is missing fields', async () => {
    fetchSpy.mockResolvedValue(okResponse({}));

    const result = await api.sendC2CText('user-x', 'test');
    expect(result).toEqual({ id: '', timestamp: '' });
  });

  it('throws on non-ok response', async () => {
    fetchSpy.mockResolvedValue(errorResponse(429, { code: 22009, message: 'rate limited' }));

    await expect(api.sendC2CText('user-x', 'test')).rejects.toThrow('code=22009');
    await expect(api.sendC2CText('user-x', 'test')).rejects.toThrow('rate limited');
  });

  it('throws on HTTP error without json code', async () => {
    fetchSpy.mockResolvedValue(errorResponse(500, {}));

    await expect(api.sendC2CText('user-x', 'test')).rejects.toThrow('code=500');
  });

  it('calls getToken for every request', async () => {
    fetchSpy.mockResolvedValue(okResponse({ id: 'm1', timestamp: 't1' }));
    await api.sendC2CText('u1', 'hi');
    fetchSpy.mockResolvedValue(okResponse({ id: 'm2', timestamp: 't2' }));
    await api.sendC2CText('u2', 'hey');

    expect(getToken).toHaveBeenCalledTimes(2);
  });
});
