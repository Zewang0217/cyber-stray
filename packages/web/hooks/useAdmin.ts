"use client";

import { useCallback, useEffect, useState } from "react";

export interface TenantRow {
  tenantId: string;
  tenantName: string;
  petId: string;
  petName: string;
  plan: "free" | "pro" | "byok";
  status: "active" | "paused";
  boredom: number;
  energy: number;
  lastRunAt: number | null;
  totalWanders: number;
  totalPushes: number;
}

interface UseAdminReturn {
  rows: TenantRow[] | null;
  error: string | null;
  isAdmin: boolean | null;
  refresh: () => Promise<void>;
  setPlan: (tenantId: string, plan: TenantRow["plan"]) => Promise<boolean>;
  setStatus: (tenantId: string, status: TenantRow["status"]) => Promise<boolean>;
}

/**
 * 运营管理面板 Hook（S13）：GET/PUT /api/admin/*。
 * isAdmin=null 表示未判定（加载中）；false 表示无权限（403）。
 */
export function useAdmin(): UseAdminReturn {
  const [rows, setRows] = useState<TenantRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/admin/tenants");
      if (res.status === 403 || res.status === 401) {
        setIsAdmin(false);
        return;
      }
      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        data?: TenantRow[];
      };
      if (json.success && json.data) {
        setRows(json.data);
        setIsAdmin(true);
        setError(null);
      } else {
        setError(json.error ?? "加载失败");
      }
    } catch {
      setError("网络错误");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = useCallback(
    async (
      tenantId: string,
      action: string,
      body: Record<string, unknown>,
    ): Promise<boolean> => {
      try {
        const res = await fetch(`/api/admin/tenants/${tenantId}/${action}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as { success: boolean; error?: string };
        if (!json.success) {
          setError(json.error ?? "操作失败");
          return false;
        }
      } catch {
        // 网络失败 / 非 JSON 响应：显式反馈，不静默（与 useEvolution 一致）
        setError("操作失败");
        return false;
      }
      setError(null);
      await refresh();
      return true;
    },
    [refresh],
  );

  const setPlan = useCallback(
    (tenantId: string, plan: TenantRow["plan"]): Promise<boolean> =>
      mutate(tenantId, "plan", { plan }),
    [mutate],
  );
  const setStatus = useCallback(
    (tenantId: string, status: TenantRow["status"]): Promise<boolean> =>
      mutate(tenantId, "status", { status }),
    [mutate],
  );

  return { rows, error, isAdmin, refresh, setPlan, setStatus };
}
