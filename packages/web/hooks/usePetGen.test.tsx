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
  fetchMock.mockImplementation(async (url: string) => ({ json: async () => ({
    success: true,
    data: url === '/api/petgen/tasks' ? [failedTask] : { available: true, limit: 2, used: 0, remaining: 2 },
  }) }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe('usePetGen 质检恢复 API', () => {
  it('街角只读进度不加载配额，并明确暴露服务端读取失败', async () => {
    let value!: ReturnType<typeof usePetGen>;
    const Probe = () => { value = usePetGen({ loadQuota: false }); return null; };
    root = createRoot(document.createElement('div'));
    fetchMock.mockImplementation(async () => ({ json: async () => ({ success: false, error: '会话已过期' }) }));
    await act(async () => root.render(<Probe />));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/petgen/tasks']);
    expect(value.error).toBe('会话已过期');
  });
  it('POST retry-qc 并消费返回的任务视图，不提交 spec 或 restart', async () => {
    let value!: ReturnType<typeof usePetGen>;
    const Probe = () => { value = usePetGen(); return null; };
    root = createRoot(document.createElement('div'));
    await act(async () => root.render(<Probe />));
    expect(value.task?.status).toBe('failed');

    fetchMock.mockClear();
    fetchMock.mockImplementation(async () => ({ json: async () => ({
      success: true, data: { ...failedTask, status: 'qc', canRetryQc: false, error: null },
    }) }));
    await act(async () => { expect(await value.retryQc('task-1')).toBe(true); });

    expect(fetchMock).toHaveBeenCalledWith('/api/petgen/tasks/task-1/retry-qc', { method: 'POST' });
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain('/api/petgen/tasks');
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/restart'))).toBe(false);
    expect(value.task?.status).toBe('qc');
  });
});
