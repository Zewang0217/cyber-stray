"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiResponse } from "@/lib/types";

/** 表情包条目（图鉴 API 视图） */
export interface MemeEntry {
  id: string;
  topic: string;
  emotion: string;
  date: string;
  mode: "abstract" | "ip";
  createdAt: number;
  imageUrl: string;
}

interface UseMemeReturn {
  memes: MemeEntry[] | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** 删除一张（成功返回 true） */
  remove: (id: string) => Promise<boolean>;
}

/**
 * 表情包图鉴 Hook（#96）：列表 + 删除。
 * 数据源 /api/meme（agent 生成管线收录，仅展示过质检的）。
 */
export function useMeme(options: { enabled?: boolean } = {}): UseMemeReturn {
  const { enabled = true } = options;
  const [memes, setMemes] = useState<MemeEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      if (!enabled) return;
      const res = await fetch("/api/meme");
      const json = (await res.json()) as ApiResponse<MemeEntry[]>;
      if (json.success && json.data) {
        setMemes(json.data);
        setError(null);
      } else {
        setError(json.error ?? "加载失败");
      }
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/meme/${id}`, { method: "DELETE" });
      const json = (await res.json()) as ApiResponse<{ id: string }>;
      if (!json.success) {
        setError(json.error ?? "删除失败");
        return false;
      }
      setMemes((prev) => (prev ? prev.filter((m) => m.id !== id) : prev));
      return true;
    } catch {
      setError("网络错误");
      return false;
    }
  }, []);

  return { memes, loading, error, refresh, remove };
}
