// @vitest-environment jsdom
/**
 * useHistory 分页测试（#123）
 *
 * 契约：
 * - 首屏 reset：拉 ?limit=pageSize&offset=0，items/total/hasMore 填充
 * - loadMore append：按已加载条数作 offset 追加，与已有去重（offset 漂移安全）
 * - 轮询 merge：新记录插顶、已加载保留（不打断阅读位置）、无重复
 * - 请求失败 → error 可见、不崩
 */

import { describe, it, expect, vi, type Mock, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PushContent } from '@/lib/types';
import { useHistory } from './useHistory';

function makeItem(n: number): PushContent {
  return {
    message: `m${n}`,
    title: `t${n}`,
    summary: `s${n}`,
    timestamp: `2026-08-${10 + n}T00:00:00Z`,
  };
}

interface ProbeValue {
  items: PushContent[];
  total: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => void;
}

function renderHistoryHook(options: { refreshSignal?: number; realtimeConnected?: boolean; pageSize?: number } = {}) {
  let value!: ProbeValue;
  const Probe = () => {
    value = useHistory({ pageSize: 2, ...options });
    return null;
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  root.render(<Probe />);
  return { get: () => value, root };
}

const ALL = Array.from({ length: 5 }, (_, i) => makeItem(i));
/** API 按 timestamp 倒序（最新在前） */
const DESC = [...ALL].reverse();

function jsonResponse(data: PushContent[], offset: number, limit: number) {
  const total = DESC.length;
  return {
    success: true,
    data,
    pagination: { total, offset, limit, hasMore: offset + limit < total },
  };
}

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

let fetchMock: Mock<FetchImpl>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    const u = new URL(url, 'http://x');
    const limit = Number(u.searchParams.get('limit') ?? 2);
    const offset = Number(u.searchParams.get('offset') ?? 0);
    return { json: async () => jsonResponse(DESC.slice(offset, offset + limit), offset, limit) } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useHistory 分页（#123）', () => {
  it('首屏 reset：拉 offset=0 页，items/total/hasMore 正确', async () => {
    const { get, root } = renderHistoryHook();
    await act(async () => { await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledWith('/api/history?limit=2&offset=0');
    expect(get().items.map((i) => i.message)).toEqual(['m4', 'm3']);
    expect(get().total).toBe(5);
    expect(get().hasMore).toBe(true);
    root.unmount();
  });

  it('loadMore append：按已加载数追加，offset 漂移时去重', async () => {
    const { get, root } = renderHistoryHook();
    await act(async () => { await Promise.resolve(); });
    fetchMock.mockClear();
    await act(async () => { get().loadMore(); await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledWith('/api/history?limit=2&offset=2');
    expect(get().items.map((i) => i.message)).toEqual(['m4', 'm3', 'm2', 'm1']);
    expect(get().hasMore).toBe(true);
    root.unmount();
  });

  it('轮询 merge：新记录插顶、已加载保留、无重复', async () => {
    const { get, root } = renderHistoryHook({ realtimeConnected: true });
    await act(async () => { await Promise.resolve(); });
    // 模拟轮询：第一页出现一条新记录 m5（时间更新），其余同前
    const withNew = [makeItem(5), ...ALL.slice(0, 2)];
    fetchMock.mockImplementation(async () => ({
      json: async () => ({
        success: true,
        data: withNew,
        pagination: { total: 6, offset: 0, limit: 6, hasMore: false },
      }),
    }) as Response);
    await act(async () => { vi.advanceTimersByTime(61_000); await Promise.resolve(); });
    const msgs = get().items.map((i) => i.message);
    expect(msgs[0]).toBe('m5'); // 新记录插顶
    expect(msgs).toContain('m4');
    expect(msgs).toContain('m3');
    expect(new Set(msgs).size).toBe(msgs.length); // 无重复
    root.unmount();
  });

  it('请求失败 → error 可见、不崩', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('网络错误');
    });
    const { get, root } = renderHistoryHook();
    await act(async () => { await Promise.resolve(); });
    expect(get().error).toBe('网络错误');
    expect(get().isLoading).toBe(false);
    root.unmount();
  });
});
