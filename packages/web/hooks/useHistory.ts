"use client";

import { useEffect, useRef, useState } from "react";
import type { PushContent, ApiResponse } from "@/lib/types";

interface UseHistoryOptions {
  /** S8：SSE 刷新信号（变化即拉取） */
  refreshSignal?: number;
  /** SSE 是否连通（连通时降频轮询为健康心跳；断开回落 5s 兜底——总线无重放，
   * 断线期间的 worker 事件永久丢失，只能靠轮询补齐） */
  realtimeConnected?: boolean;
}

interface UseHistoryReturn {
  items: PushContent[];
  isLoading: boolean;
  error: string | null;
}

/**
 * 获取历史推送记录的 Hook。
 * SSE 实时（refreshSignal 变化立即拉）+ 定时轮询兜底（同 useAgentState）。
 */
export function useHistory(options: UseHistoryOptions = {}): UseHistoryReturn {
  const { refreshSignal = 0, realtimeConnected = false } = options;
  const [items, setItems] = useState<PushContent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchHistoryRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    const fetchHistory = async (): Promise<void> => {
      try {
        const res = await fetch("/api/history");
        const json = (await res.json()) as ApiResponse<PushContent[]>;

        if (!json.success) {
          throw new Error(json.error ?? "获取历史记录失败");
        }

        setItems(json.data ?? []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "未知错误");
      } finally {
        setIsLoading(false);
      }
    };
    fetchHistoryRef.current = fetchHistory;
    void fetchHistory();
  }, []);

  useEffect(() => {
    if (refreshSignal > 0) void fetchHistoryRef.current();
  }, [refreshSignal]);

  // 定时轮询兜底：SSE 断开时事件无重放（内存总线），只能轮询补齐
  useEffect(() => {
    const interval = setInterval(
      () => void fetchHistoryRef.current(),
      realtimeConnected ? 60_000 : 15_000,
    );
    return () => clearInterval(interval);
  }, [realtimeConnected]);

  return { items, isLoading, error };
}
