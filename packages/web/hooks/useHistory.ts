"use client";

import { useEffect, useState } from "react";
import type { PushContent, ApiResponse } from "@/lib/types";

interface UseHistoryReturn {
  items: PushContent[];
  isLoading: boolean;
  error: string | null;
}

/**
 * 获取历史推送记录的 Hook
 */
export function useHistory(): UseHistoryReturn {
  const [items, setItems] = useState<PushContent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHistory = async (): Promise<void> => {
      try {
        const res = await fetch("/api/history");
        const json = (await res.json()) as ApiResponse<PushContent[]>;

        if (!json.success) {
          throw new Error(json.error ?? "获取历史记录失败");
        }

        setItems(json.data ?? []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "未知错误");
      } finally {
        setIsLoading(false);
      }
    };

    fetchHistory();
  }, []);

  return { items, isLoading, error };
}
