"use client";

import { useCallback, useEffect, useState } from "react";
import { isPlanState, type PlanState } from "@cyber-stray/shared/plan";

interface UsePlanReturn {
  plan: PlanState | null;
  error: string | null;
  refresh: () => Promise<void>;
  setPushWindow: (startHour: number, endHour: number) => Promise<boolean>;
  clearPushWindow: () => Promise<boolean>;
  bindByokKey: (apiKey: string) => Promise<boolean>;
}

/**
 * 读取控制面决定的有效权益，设置推送窗口与可选自带密钥。
 * 付费授权由控制面拥有，普通用户不能直接变更套餐。
 */
export function usePlan(): UsePlanReturn {
  const [plan, setPlan] = useState<PlanState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/plan");
      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        data?: unknown;
      };
      if (!res.ok || !json.success) throw new Error(json.error ?? "权益加载失败");
      if (!isPlanState(json.data)) throw new Error("权益响应格式错误");
      setPlan(json.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "权益加载失败");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = useCallback(
    async (url: string, init: RequestInit, failMsg: string): Promise<boolean> => {
      try {
        const res = await fetch(url, {
          headers: { "content-type": "application/json" },
          ...init,
        });
        const json = (await res.json()) as { success: boolean; error?: string };
        if (!json.success) {
          setError(json.error ?? failMsg);
          return false;
        }
      } catch {
        // 网络失败 / 非 JSON 响应（网关 502 HTML 等）：显式反馈，不静默
        setError(failMsg);
        return false;
      }
      setError(null);
      await refresh();
      return true;
    },
    [refresh],
  );

  const setPushWindow = useCallback(
    (startHour: number, endHour: number): Promise<boolean> =>
      mutate(
        "/api/plan/push-window",
        { method: "PUT", body: JSON.stringify({ startHour, endHour }) },
        "窗口设置失败",
      ),
    [mutate],
  );

  const clearPushWindow = useCallback(
    (): Promise<boolean> => mutate("/api/plan/push-window", { method: "DELETE" }, "清除失败"),
    [mutate],
  );

  const bindByokKey = useCallback(
    (apiKey: string): Promise<boolean> =>
      mutate(
        "/api/plan/byok-key",
        { method: "PUT", body: JSON.stringify({ apiKey }) },
        "绑定失败",
      ),
    [mutate],
  );

  return { plan, error, refresh, setPushWindow, clearPushWindow, bindByokKey };
}
