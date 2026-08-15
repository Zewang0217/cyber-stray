"use client";

import { useEffect, useState } from "react";
import type { AgentState, ApiResponse } from "@/lib/types";

interface UseAgentStateReturn {
  state: AgentState | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * 获取 Agent 状态的 Hook
 * 每 5 秒轮询自动刷新
 */
export function useAgentState(): UseAgentStateReturn {
  const [state, setState] = useState<AgentState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

    fetchState();
    const interval = setInterval(fetchState, 5000);
    return () => clearInterval(interval);
  }, []);

  return { state, isLoading, error };
}
