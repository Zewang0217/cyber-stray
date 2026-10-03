"use client";

import { useCallback, useEffect, useState } from "react";
import type { PetGenQuota, PetGenTaskView, PetSpec } from "@cyber-stray/shared/petgen";
import type { ApiResponse } from "@/lib/types";

/** 任务 / 配额 / spec 契约见 shared/petgen（CP 服务层视图构造同源） */

interface UsePetGenReturn {
  /** 任务轮询结果（当前活跃任务） */
  task: PetGenTaskView | null;
  quota: PetGenQuota | null;
  loading: boolean;
  error: string | null;
  /** 提交 spec（Pro/BYOK 专属；403 = 无入口） */
  submit: (spec: PetSpec) => Promise<PetGenTaskView | null>;
  /** 确认概念图 → 开始多状态生成 */
  confirm: (taskId: string) => Promise<boolean>;
  /** 不满意：改 spec 重出概念图 */
  restart: (taskId: string, spec: PetSpec) => Promise<boolean>;
  /** 手动刷新任务 */
  refresh: () => Promise<void>;
}

/**
 * 宠物 IP 定制 Hook：提交 spec → 概念图 → 确认/调整 → 生成 + 质检。
 * 任务在 CP 侧异步队列推进，前端轮询 GET /tasks/:id 直到停驻态
 * （awaiting_confirmation 等用户 / done / failed）。
 */
export function usePetGen(): UsePetGenReturn {
  const [task, setTask] = useState<PetGenTaskView | null>(null);
  const [quota, setQuota] = useState<PetGenQuota | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshQuota = useCallback(async () => {
    try {
      const res = await fetch("/api/petgen/quota");
      const json = (await res.json()) as ApiResponse<PetGenQuota>;
      if (json.success && json.data) setQuota(json.data);
    } catch {
      // 未登录等场景静默——页面级鉴权已兜
    }
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/petgen/tasks");
      const json = (await res.json()) as ApiResponse<PetGenTaskView[]>;
      if (json.success) {
        setTask(json.data?.[0] ?? null);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "任务加载失败");
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshQuota();
  }, [refresh, refreshQuota]);

  /** 轮询任务直到离开进行中状态（确认流展示用） */
  useEffect(() => {
    if (!task) return;
    const busy =
      task.status === "spec_submitted" ||
      task.status === "concept_generating" ||
      task.status === "generating_states" ||
      task.status === "qc";
    if (!busy) return;
    const id = window.setInterval(() => {
      void refresh();
    }, 2000);
    return () => window.clearInterval(id);
  }, [task, refresh]);

  const submit = useCallback(
    async (spec: PetSpec): Promise<PetGenTaskView | null> => {
      setLoading(true);
      try {
        const res = await fetch("/api/petgen/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(spec),
        });
        const json = (await res.json()) as ApiResponse<PetGenTaskView>;
        if (!json.success || !json.data) {
          // 403 = 免费无入口；429 = 配额超限；都透出服务端文案
          setError(json.error ?? "提交失败");
          void refreshQuota();
          return null;
        }
        setError(null);
        setTask(json.data);
        void refreshQuota();
        return json.data;
      } catch (err) {
        setError(err instanceof Error ? err.message : "提交失败");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [refreshQuota],
  );

  const confirm = useCallback(
    async (taskId: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/petgen/tasks/${taskId}/confirm`, { method: "POST" });
        const json = (await res.json()) as ApiResponse<PetGenTaskView>;
        if (!json.success) {
          setError(json.error ?? "确认失败");
          return false;
        }
        setError(null);
        if (json.data) setTask(json.data);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "确认失败");
        return false;
      }
    },
    [],
  );

  const restart = useCallback(
    async (taskId: string, spec: PetSpec): Promise<boolean> => {
      try {
        const res = await fetch(`/api/petgen/tasks/${taskId}/restart`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(spec),
        });
        const json = (await res.json()) as ApiResponse<PetGenTaskView>;
        if (!json.success) {
          setError(json.error ?? "调整失败");
          return false;
        }
        setError(null);
        if (json.data) setTask(json.data);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "调整失败");
        return false;
      }
    },
    [],
  );

  return { task, quota, loading, error, submit, confirm, restart, refresh };
}
