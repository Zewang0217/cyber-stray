"use client";

import { useCallback, useEffect, useState } from "react";
import type { Catchphrase, PersonalityId } from "@cyber-stray/shared";
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
  /** 性格（#90：认领时选择；好奇=默认基准） */
  personality: PersonalityId;
  /** 口头禅集合（#114；GET 映射后始终为数组——NULL 列服务端已转性格默认组） */
  catchphrases: Catchphrase[];
  sleepStart: number | null;
  sleepEnd: number | null;
  /** 日记风格（#92；'personality' = 跟随性格） */
  diaryStyle: "personality" | "casual" | "careful" | "literary";
  /** 是否推送每日日记（#92；Web Push） */
  diaryPushEnabled: boolean;
  createdAt: number;
  updatedAt: number;
}

interface UsePetsReturn {
  pets: Pet[];
  /** 是否已加载完成（区分"还没加载"与"确实没有宠物"） */
  isLoaded: boolean;
  error: string | null;
  /** 领养（服务端校验；409 = 已有宠物会刷新列表） */
  adopt: (input: {
    name: string;
    interests?: string[];
    personality?: PersonalityId;
    catchphrases?: Catchphrase[];
  }) => Promise<Pet | null>;
  adopting: boolean;
  /** 手动重拉宠物列表（领养/改动作后同步） */
  refresh: () => Promise<void>;
  /** 设置作息（本地小时；跨午夜合法）。成功返回 true */
  setSleepSchedule: (startHour: number, endHour: number) => Promise<boolean>;
  /** 清除作息（回永不睡眠，与现状一致）。成功返回 true */
  clearSleepSchedule: () => Promise<boolean>;
  /** 设置日记风格（#92；personality 或具体风格）。成功返回 true */
  setDiaryStyle: (style: Pet["diaryStyle"]) => Promise<boolean>;
  /** 设置是否推送每日日记（#92）。成功返回 true */
  setDiaryPush: (enabled: boolean) => Promise<boolean>;
  /** 编辑口头禅集合（#114；至少 1 条）。成功返回 true */
  setCatchphrases: (catchphrases: Catchphrase[]) => Promise<boolean>;
}

/**
 * 租户宠物列表 + 领养。
 * 空列表 = 未领养 → 前端走领养流程。前端状态是便捷，
 * 服务端 session claim 才是租户真相（issue #74）。
 */
export function usePets(options: { enabled?: boolean } = {}): UsePetsReturn {
  const { enabled = true } = options;
  const [pets, setPets] = useState<Pet[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adopting, setAdopting] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
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
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setIsLoaded(true);
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  const adopt = useCallback(
    async (input: {
      name: string;
      interests?: string[];
      personality?: PersonalityId;
      catchphrases?: Catchphrase[];
    }): Promise<Pet | null> => {
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

  /** 宠物配置变更（#91/#92）：PUT/DELETE 后刷新宠物行。成功返回 true */
  const mutatePetSetting = useCallback(
    async (url: string, body: unknown, failMsg: string): Promise<boolean> => {
      try {
        const res = await fetch(url, {
          method: body === null ? "DELETE" : "PUT",
          headers: { "content-type": "application/json" },
          body: body === null ? undefined : JSON.stringify(body),
        });
        const json = (await res.json()) as ApiResponse<unknown>;
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

  const setSleepSchedule = useCallback(
    (startHour: number, endHour: number): Promise<boolean> =>
      mutatePetSetting(
        "/api/pets/sleep-schedule",
        { startHour, endHour },
        "作息设置失败",
      ),
    [mutatePetSetting],
  );

  const clearSleepSchedule = useCallback(
    (): Promise<boolean> => mutatePetSetting("/api/pets/sleep-schedule", null, "作息清除失败"),
    [mutatePetSetting],
  );

  const setDiaryStyle = useCallback(
    (style: Pet["diaryStyle"]): Promise<boolean> =>
      mutatePetSetting("/api/pets/diary-style", { diaryStyle: style }, "日记风格设置失败"),
    [mutatePetSetting],
  );

  const setDiaryPush = useCallback(
    (enabled: boolean): Promise<boolean> =>
      mutatePetSetting("/api/pets/diary-push", { enabled }, "日记推送设置失败"),
    [mutatePetSetting],
  );

  /** 编辑口头禅集合（#114；至少 1 条，服务端校验）。成功返回 true */
  const setCatchphrases = useCallback(
    (catchphrases: Catchphrase[]): Promise<boolean> =>
      mutatePetSetting("/api/pets/catchphrases", { catchphrases }, "口头禅保存失败"),
    [mutatePetSetting],
  );

  return {
    pets,
    isLoaded,
    error,
    adopt,
    adopting,
    refresh,
    setSleepSchedule,
    clearSleepSchedule,
    setDiaryStyle,
    setDiaryPush,
    setCatchphrases,
  };
}

