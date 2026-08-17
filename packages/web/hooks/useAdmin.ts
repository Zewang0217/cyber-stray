"use client";

import { useCallback, useEffect, useState } from "react";

export interface UserRow {
  tenantId: string;
  tenantName: string;
  plan: "free" | "pro" | "byok";
  createdAt: number;
  petId: string | null;
  petName: string | null;
  petStatus: "active" | "paused" | null;
  petBoredom: number | null;
  petEnergy: number | null;
  petLastRunAt: number | null;
  totalWanders: number;
  totalPushes: number;
}

export interface AdminRow {
  sub: string;
  grantedBy: string;
  createdAt: number;
}

interface UseAdminReturn {
  users: UserRow[] | null;
  admins: AdminRow[] | null;
  error: string | null;
  isAdmin: boolean | null;
  refresh: () => Promise<void>;
  setPlan: (tenantId: string, plan: UserRow["plan"]) => Promise<boolean>;
  setPetStatus: (tenantId: string, status: "active" | "paused") => Promise<boolean>;
  grantAdmin: (sub: string) => Promise<boolean>;
  revokeAdmin: (sub: string) => Promise<boolean>;
}

/**
 * 运营管理面板 Hook（S14）：GET/PUT /api/admin/*。
 * isAdmin=null 表示未判定（加载中）；false 表示无权限（403）。
 */
export function useAdmin(): UseAdminReturn {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [admins, setAdmins] = useState<AdminRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/admin/users");
      if (res.status === 403 || res.status === 401) {
        setIsAdmin(false);
        return;
      }
      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        data?: UserRow[];
      };
      if (json.success && json.data) {
        setUsers(json.data);
        setIsAdmin(true);
        setError(null);
      } else {
        setError(json.error ?? "加载失败");
      }
      // 管理员列表（用户列表成功即拉）
      const ares = await fetch("/api/admin/admins");
      if (ares.ok) {
        const ajson = (await ares.json()) as { data?: AdminRow[] };
        if (ajson.data) setAdmins(ajson.data);
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
      url: string,
      init: RequestInit,
      failMsg: string,
    ): Promise<boolean> => {
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
        setError(failMsg);
        return false;
      }
      setError(null);
      await refresh();
      return true;
    },
    [refresh],
  );

  const setPlan = useCallback(
    (tenantId: string, plan: UserRow["plan"]): Promise<boolean> =>
      mutate(`/api/admin/users/${tenantId}/plan`, { method: "PUT", body: JSON.stringify({ plan }) }, "改套餐失败"),
    [mutate],
  );
  const setPetStatus = useCallback(
    (tenantId: string, status: "active" | "paused"): Promise<boolean> =>
      mutate(`/api/admin/users/${tenantId}/pet-status`, { method: "PUT", body: JSON.stringify({ status }) }, "操作失败"),
    [mutate],
  );
  const grantAdmin = useCallback(
    (sub: string): Promise<boolean> =>
      mutate("/api/admin/admins", { method: "POST", body: JSON.stringify({ sub }) }, "授权失败"),
    [mutate],
  );
  const revokeAdmin = useCallback(
    (sub: string): Promise<boolean> =>
      mutate(`/api/admin/admins/${sub}`, { method: "DELETE" }, "撤销失败"),
    [mutate],
  );

  return { users, admins, error, isAdmin, refresh, setPlan, setPetStatus, grantAdmin, revokeAdmin };
}
