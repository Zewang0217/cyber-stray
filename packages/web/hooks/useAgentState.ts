"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentState, ApiResponse } from "@/lib/types";

interface UseAgentStateOptions {
  /** S8：SSE 刷新信号（变化即拉取；SSE 断开时回落定时轮询） */
  refreshSignal?: number;
  /** SSE 是否连通（连通时降频轮询为健康心跳） */
  realtimeConnected?: boolean;
}

interface UseAgentStateReturn {
  state: AgentState | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * 获取 Agent 状态的 Hook。
 * SSE 实时（refreshSignal 变化立即拉）+ 定时轮询兜底：
 * SSE 连通 → 60s 心跳轮询（防极端漏事件）；断开 → 5s 轮询。
 */
export function useAgentState(
  options: UseAgentStateOptions = {},
): UseAgentStateReturn {
  const { refreshSignal = 0, realtimeConnected = false } = options;
  const [state, setState] = useState<AgentState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchStateRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    const fetchState = async (): Promise<void> => {
      try {
        const res = await fetch("/api/state");
        const json = (await res.json()) as ApiResponse<AgentState>;

        if (!json.success) {
          throw new Error(json.error ?? "获取状态失败");
        }

        // data: null = 租户尚未跑过游荡（无 state.json）——空态而非错误
        setState(json.data ?? null);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "未知错误");
      } finally {
        setIsLoading(false);
      }
    };
    fetchStateRef.current = fetchState;
    void fetchState();
  }, []);

  // SSE 刷新信号：变化即拉取（worker 跑完状态/图谱/推送都可能变了）
  useEffect(() => {
    if (refreshSignal > 0) void fetchStateRef.current();
  }, [refreshSignal]);

  // 定时轮询兜底：SSE 连通降频为 60s 健康心跳；断开回落 5s
  useEffect(() => {
    const interval = setInterval(
      () => void fetchStateRef.current(),
      realtimeConnected ? 60_000 : 5_000,
    );
    return () => clearInterval(interval);
  }, [realtimeConnected]);

  return { state, isLoading, error };
}
