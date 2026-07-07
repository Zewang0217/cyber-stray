import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReconnectManager } from './reconnect.js';

describe('ReconnectManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls connectFn and returns on first success', async () => {
    const connectFn = vi.fn().mockResolvedValue(undefined);
    const manager = new ReconnectManager(connectFn);

    const promise = manager.retryConnect();
    await vi.runAllTimersAsync();
    await promise;

    expect(connectFn).toHaveBeenCalledTimes(1);
  });

  it('retries with exponential backoff on failure', async () => {
    const connectFn = vi.fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValue(undefined);
    const manager = new ReconnectManager(connectFn);

    const promise = manager.retryConnect();
    await vi.runAllTimersAsync();
    await promise;

    expect(connectFn).toHaveBeenCalledTimes(3);
  });

  it('resets attempt count on successful connect', async () => {
    const connectFn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue(undefined);
    const manager = new ReconnectManager(connectFn);

    const promise = manager.retryConnect();
    await vi.runAllTimersAsync();
    await promise;

    expect(connectFn).toHaveBeenCalledTimes(2);

    manager.reset();

    const connectFn2 = vi.fn().mockResolvedValue(undefined);
    const manager2 = new ReconnectManager(connectFn2);
    const promise2 = manager2.retryConnect();
    await vi.runAllTimersAsync();
    await promise2;

    expect(connectFn2).toHaveBeenCalledTimes(1);
  });

  it('stops retrying on fatal code 4914', async () => {
    const fatalError = Object.assign(new Error('token revoked'), { code: 4914 });
    const connectFn = vi.fn().mockRejectedValue(fatalError);
    const manager = new ReconnectManager(connectFn);

    await expect(manager.retryConnect()).rejects.toThrow('Fatal: QQ Bot 4914');
    expect(connectFn).toHaveBeenCalledTimes(1);
  });

  it('stops retrying on fatal code 4915', async () => {
    const fatalError = Object.assign(new Error('invalid session'), { code: 4915 });
    const connectFn = vi.fn().mockRejectedValue(fatalError);
    const manager = new ReconnectManager(connectFn);

    await expect(manager.retryConnect()).rejects.toThrow('Fatal: QQ Bot 4915');
    expect(connectFn).toHaveBeenCalledTimes(1);
  });

  it('throws after max attempts reached', async () => {
    const connectFn = vi.fn().mockRejectedValue(new Error('persistent failure'));
    const manager = new ReconnectManager(connectFn);

    const promise = manager.retryConnect();
    promise.catch(() => {});
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow('Max reconnect attempts reached');
    expect(connectFn).toHaveBeenCalledTimes(100);
  });
});
