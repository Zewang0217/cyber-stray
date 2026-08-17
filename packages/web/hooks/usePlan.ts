"use client";

import { useCallback, useEffect, useState } from "react";

export type PlanValue = "free" | "pro" | "byok";

interface PlanState {
  plan: PlanValue;
  limits: { pushesPerDay: number; boostIntervalMs: number };
  pushWindow: { startHour: number; endHour: number } | null;
  byok: { keyBound: boolean };
}

interface UsePlanReturn {
  plan: PlanState | null;
  error: string | null;
  refresh: () => Promise<void>;
  switchPlan: (next: PlanValue) => Promise<boolean>;
  setPushWindow: (startHour: number, endHour: number) => Promise<boolean>;
  clearPushWindow: () => Promise<boolean>;
  bindByokKey: (apiKey: string) => Promise<boolean>;
}

/**
 * 套餐 Hook（S11）：GET /api/plan + PUT 套餐/窗口/BYOK key。
 * 计费未接入前切换无支付校验（自托管早期形态）。
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
        data?: PlanState;
      };
      if (json.success && json.data) {
        setPlan(json.data);
        setError(null);
      }
    } catch {
      // 未登录等场景静默——页面级鉴权已兜
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

  const switchPlan = useCallback(
    (next: PlanValue): Promise<boolean> =>
      mutate("/api/plan", { method: "PUT", body: JSON.stringify({ plan: next }) }, "切换失败"),
    [mutate],
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

  return { plan, error, refresh, switchPlan, setPushWindow, clearPushWindow, bindByokKey };
}
