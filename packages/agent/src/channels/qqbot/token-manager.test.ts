import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TokenManager } from './token-manager.js';

describe('TokenManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches token on first call', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok-test-1', expires_in: 7200 }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const tm = new TokenManager('app-id', 'secret');
    const token = await tm.getToken();

    expect(token).toBe('tok-test-1');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://bots.qq.com/app/getAppAccessToken',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: 'app-id', clientSecret: 'secret' }),
      },
    );
  });

  it('returns cached token when valid', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok-cached', expires_in: 7200 }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const tm = new TokenManager('app-id', 'secret');
    const token1 = await tm.getToken();
    const token2 = await tm.getToken();

    expect(token1).toBe('tok-cached');
    expect(token2).toBe('tok-cached');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes token after expiry', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        json: async () => ({ access_token: `tok-${callCount}`, expires_in: 7200 }),
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const tm = new TokenManager('app-id', 'secret');
    const token1 = await tm.getToken();
    expect(token1).toBe('tok-1');

    vi.advanceTimersByTime(7101 * 1000);

    const token2 = await tm.getToken();
    expect(token2).toBe('tok-2');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws on fetch failure', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Invalid credentials' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const tm = new TokenManager('app-id', 'secret');
    await expect(tm.getToken()).rejects.toThrow('Invalid credentials');
  });

  it('authHeader returns correct format', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'tok-auth', expires_in: 7200 }),
      }),
    );

    const tm = new TokenManager('app-id', 'secret');
    await tm.getToken();

    expect(tm.authHeader()).toBe('QQBot tok-auth');
  });

  it('authHeader returns empty placeholder when no token fetched', () => {
    const tm = new TokenManager('app-id', 'secret');
    expect(tm.authHeader()).toBe('QQBot ');
  });
});
