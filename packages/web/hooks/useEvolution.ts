"use client";

import { useCallback, useEffect, useState } from "react";

export interface SnapshotNode {
  id: string;
  weight: number;
  source: string;
  reinforceCount: number;
}

export interface EvolutionSnapshot {
  timestamp: string;
  hash: string;
  entropy: number;
  /** CP 旧契约未透传；客户端以 nodes.length 派生 */
  nodeCount?: number;
  nodes: SnapshotNode[];
  source?: string;
}

export interface FeedbackEvent {
  type: "like" | "dislike" | "boost";
  topic?: string;
  messageId?: string;
  timestamp: string;
}

interface EvolutionState {
  snapshots: EvolutionSnapshot[];
  feedbacks: FeedbackEvent[];
  summary: { totalWanders: number; totalPushes: number };
}

interface UseEvolutionReturn {
  data: EvolutionState | null;
  error: string | null;
  refresh: () => Promise<void>;
  rollback: (hash: string) => Promise<boolean>;
}

/**
 * 进化可视化 Hook（S13）：GET /api/evolution + POST /api/evolution/rollback。
 */
export function useEvolution(options: { enabled?: boolean } = {}): UseEvolutionReturn {
  const { enabled = true } = options;
  const [data, setData] = useState<EvolutionState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/evolution");
      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        data?: EvolutionState;
      };
      if (json.success && json.data) {
        setData(json.data);
        setError(null);
      } else {
        setError(json.error ?? "加载失败");
      }
    } catch {
      setError("网络错误");
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [refresh]);

  const rollback = useCallback(
    async (hash: string): Promise<boolean> => {
      try {
        const res = await fetch("/api/evolution/rollback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hash }),
        });
        const json = (await res.json()) as { success: boolean; error?: string };
        if (!json.success) {
          setError(json.error ?? "回滚失败");
          return false;
        }
        setError(null);
        await refresh();
        return true;
      } catch {
        setError("回滚失败");
        return false;
      }
    },
    [refresh],
  );

  return { data, error, refresh, rollback };
}
