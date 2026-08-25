"use client";

import { useCallback, useEffect, useState } from "react";

export interface UsageSummary {
  totalCost: number;
  totalLlmTokens: number;
  totalImages: number;
  totalVisionQc: number;
}

export interface TenantUsage {
  tenantId: string;
  tenantName: string;
  plan: "free" | "pro" | "byok";
  llmTokens: number;
  imageCount: number;
  visionCount: number;
  cost: number;
  lastActive: string | null;
}

export interface UsageRecord {
  timestamp: string;
  tenantId: string;
  kind: "llm" | "image" | "vision_qc";
  model: string;
  tokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  images?: number;
  cost: number;
}

export interface UsageData {
  summary: UsageSummary;
  perTenant: TenantUsage[];
  recent: UsageRecord[];
}

export interface ModelConfigData {
  imageModel: string;
  visionModel: string;
  candidates: { image: string[]; vision: string[] };
}

export type UsageRange = "all" | "7d" | "30d" | "month";

/** 本地日期 YYYY-MM-DD */
function dateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 时间筛选 → from/to 查询参数（all = 无参数） */
export function rangeToQuery(range: UsageRange): string {
  const now = new Date();
  if (range === "all") return "";
  if (range === "7d") return `?from=${dateKey(new Date(now.getTime() - 7 * 86400000))}`;
  if (range === "30d") return `?from=${dateKey(new Date(now.getTime() - 30 * 86400000))}`;
  return `?from=${dateKey(new Date(now.getFullYear(), now.getMonth(), 1))}`;
}

interface UseUsageReturn {
  data: UsageData | null;
  modelConfig: ModelConfigData | null;
  error: string | null;
  range: UsageRange;
  setRange: (r: UsageRange) => void;
  updateModel: (patch: { imageModel?: string; visionModel?: string }) => Promise<boolean>;
}

/**
 * 用量成本面板（ADR-0007）：GET /api/admin/usage（时间筛选）+ 模型配置
 * GET/PUT /api/admin/config。
 */
export function useUsage(): UseUsageReturn {
  const [data, setData] = useState<UsageData | null>(null);
  const [modelConfig, setModelConfigState] = useState<ModelConfigData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRangeState] = useState<UsageRange>("all");

  const load = useCallback(async (r: UsageRange): Promise<void> => {
    try {
      const res = await fetch(`/api/admin/usage${rangeToQuery(r)}`);
      const json = (await res.json()) as { success: boolean; error?: string; data?: UsageData };
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

  const loadConfig = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/admin/config");
      const json = (await res.json()) as { success: boolean; data?: ModelConfigData };
      if (json.success && json.data) setModelConfigState(json.data);
    } catch {
      // 配置加载失败不阻断用量展示
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [range, load]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const setRange = useCallback((r: UsageRange) => {
    setRangeState(r);
  }, []);

  const updateModel = useCallback(
    async (patch: { imageModel?: string; visionModel?: string }): Promise<boolean> => {
      try {
        const res = await fetch("/api/admin/config", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        const json = (await res.json()) as { success: boolean; error?: string; data?: ModelConfigData };
        if (!json.success) {
          setError(json.error ?? "更新模型失败");
          return false;
        }
        if (json.data) setModelConfigState(json.data);
        setError(null);
        return true;
      } catch {
        setError("网络错误");
        return false;
      }
    },
    [],
  );

  return { data, modelConfig, error, range, setRange, updateModel };
}

/** token 数格式化（1.5M / 87.3K） */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
