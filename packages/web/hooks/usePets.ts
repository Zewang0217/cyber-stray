"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiResponse } from "@/lib/types";

/** 控制面 pets 行（编排状态；详细字段见 control-plane/src/db/schema.ts） */
export interface Pet {
  id: string;
  tenantId: string;
  name: string;
  status: "active" | "paused";
  lastRunAt: number | null;
  cooldownUntil: number | null;
  boredom: number;
  energy: number;
  plan: "free" | "pro" | "byok";
  createdAt: number;
  updatedAt: number;
}

interface UsePetsReturn {
  pets: Pet[];
  /** 是否已加载完成（区分"还没加载"与"确实没有宠物"） */
  isLoaded: boolean;
  error: string | null;
  /** 领养（服务端校验；409 = 已有宠物会刷新列表） */
  adopt: (input: { name: string; interests?: string[] }) => Promise<Pet | null>;
  adopting: boolean;
}

/**
 * 租户宠物列表 + 领养。
 * 空列表 = 未领养 → 前端走领养流程。前端状态是便捷，
 * 服务端 session claim 才是租户真相（issue #74）。
 */
export function usePets(): UsePetsReturn {
  const [pets, setPets] = useState<Pet[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adopting, setAdopting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/pets");
      const json = (await res.json()) as ApiResponse<Pet[]>;
      if (!json.success) {
        throw new Error(json.error ?? "获取宠物失败");
      }
      setPets(json.data ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const adopt = useCallback(
    async (input: { name: string; interests?: string[] }): Promise<Pet | null> => {
      setAdopting(true);
      try {
        const res = await fetch("/api/pets/adopt", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        });
        const json = (await res.json()) as ApiResponse<Pet>;
        if (!json.success || !json.data) {
          // 409 = 已有宠物：刷新列表拿回现有
          if (res.status === 409) {
            await refresh();
            return null;
          }
          throw new Error(json.error ?? "领养失败");
        }
        setPets((prev) => [...prev, json.data as Pet]);
        return json.data;
      } catch (err) {
        setError(err instanceof Error ? err.message : "未知错误");
        return null;
      } finally {
        setAdopting(false);
      }
    },
    [refresh],
  );

  return { pets, isLoaded, error, adopt, adopting };
}
