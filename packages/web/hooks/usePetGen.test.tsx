// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PetGenTaskView } from '@cyber-stray/shared/petgen';
import { usePetGen } from './usePetGen';

const failedTask: PetGenTaskView = {
  id: 'task-1', status: 'failed', specText: '一只黑猫', stylePreset: 'pixel',
  conceptUrl: '/api/petgen/tasks/task-1/concept.png', error: '视觉质检连续异常',
  canRetryQc: true, qcResult: null, conceptAttempts: 1,
  createdAt: 1, updatedAt: 2, completedAt: null, assetBase: null,
};

let root: Root;
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => ({ ok: true, json: async () => ({
    success: true,
    data: url === '/api/petgen/tasks' ? [failedTask] : { available: true, period: 'rolling_week', unlimited: false, limit: 1, used: 0, remaining: 1, resetAt: null },
  }) }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('usePetGen 质检恢复 API', () => {
  it('任务刷新成功不会掩盖额度错误，手动刷新可重新获取额度', async () => {
    const normalFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/quota')
      ? { ok: false, json: async () => ({ success: false, error: '额度服务不可用' }) }
      : normalFetch(url));
    let value!: ReturnType<typeof usePetGen>;
    const Probe = () => { value = usePetGen(); return null; };
    root = createRoot(document.createElement('div'));
    await act(async () => root.render(<Probe />));
    await act(async () => { await value.refresh(); });
    expect(value.error).toBe('额度服务不可用');
    expect(value.quota).toBeNull();
    fetchMock.mockImplementation(normalFetch);
    await act(async () => { await value.refresh(); });
    expect(value.error).toBeNull();
    expect(value.quota?.remaining).toBe(1);
  });

  it('等待期到达 resetAt 后自动重拉额度，无需刷新页面', async () => {
    vi.useFakeTimers();
    const resetAt = new Date(Date.now() + 5000).toISOString();
    let expired = false;
    fetchMock.mockImplementation(async (url: string) => ({ ok: true, json: async () => ({
      success: true, data: url.endsWith('/tasks') ? [{ ...failedTask, status: 'done' }] : {
        available: true, period: 'rolling_week', unlimited: false, limit: 1,
        used: expired ? 0 : 1, remaining: expired ? 1 : 0, resetAt: expired ? null : resetAt,
      },
    }) }));
    let value!: ReturnType<typeof usePetGen>;
    const Probe = () => { value = usePetGen(); return null; };
    root = createRoot(document.createElement('div'));
    await act(async () => root.render(<Probe />));
    expect(value.quota?.remaining).toBe(0);
    expired = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(value.quota?.remaining).toBe(1);
  });

  it('POST retry-qc 并消费返回的任务视图，不提交 spec 或 restart', async () => {
    let value!: ReturnType<typeof usePetGen>;
    const Probe = () => { value = usePetGen(); return null; };
    root = createRoot(document.createElement('div'));
    await act(async () => root.render(<Probe />));
    expect(value.task?.status).toBe('failed');

    fetchMock.mockClear();
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({
      success: true, data: { ...failedTask, status: 'qc', canRetryQc: false, error: null },
    }) }));
    await act(async () => { expect(await value.retryQc('task-1')).toBe(true); });

    expect(fetchMock).toHaveBeenCalledWith('/api/petgen/tasks/task-1/retry-qc', { method: 'POST' });
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain('/api/petgen/tasks');
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/restart'))).toBe(false);
    expect(value.task?.status).toBe('qc');
  });
});
