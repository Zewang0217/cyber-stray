"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiResponse, PaginationMeta, PushContent } from "@/lib/types";

interface UseHistoryOptions {
  /** S8：SSE 刷新信号（变化即拉取） */
  refreshSignal?: number;
  /** SSE 是否连通（连通时降频轮询为健康心跳；断开回落 5s 兜底——总线无重放，
   * 断线期间的 worker 事件永久丢失，只能靠轮询补齐） */
  realtimeConnected?: boolean;
  /** 每页条数（#123 分页；默认 50） */
  pageSize?: number;
}

interface UseHistoryReturn {
  items: PushContent[];
  /** 记录总数（分页元数据） */
  total: number;
  /** 首屏加载中 */
  isLoading: boolean;
  /** 滚动加载更多进行中 */
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => void;
}

/** /api/history 分页响应（ApiResponse + pagination） */
interface HistoryResponse extends ApiResponse<PushContent[]> {
  pagination?: PaginationMeta;
}

/** 记录去重键（无稳定 id：timestamp+正文） */
function recordKey(it: PushContent): string {
  return `${it.timestamp}|${it.message}`;
}

/**
 * 获取历史推送记录的 Hook（#123 分页）。
 * - 首屏 / SSE 刷新：reset（清空重拉第一页；reqId 递增使在飞旧请求作废）
 * - 滚动到底：append（按已加载条数追加下一页；loadingRef 守卫防并发）
 * - 轮询兜底：merge（拉第一页大窗口与现有合并去重——保留已加载内容，
 *   新记录插顶，不打断阅读位置）
 *
 * 并发模型：reset/merge 各递增 reqId，响应应用前校验仍为最新（后到者胜）；
 * append 不递增，若期间出现新基线则丢弃结果。loadedRef/itemsRef 在
 * setState updater 外同步（updater 必须纯函数——React StrictMode 双调用安全）。
 */
export function useHistory(options: UseHistoryOptions = {}): UseHistoryReturn {
  const { refreshSignal = 0, realtimeConnected = false, pageSize = 50 } = options;
  const [items, setItems] = useState<PushContent[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  /** 已加载条数（append 的 offset 基准） */
  const loadedRef = useRef(0);
  /** items 同步镜像（updater 外读当前列表） */
  const itemsRef = useRef<PushContent[]>([]);
  /** 基线请求 id：reset/merge 递增，使在飞旧请求结果作废（防乱序覆盖） */
  const reqIdRef = useRef(0);

  const applyItems = useCallback((updater: (prev: PushContent[]) => PushContent[]) => {
    setItems((prev) => {
      const next = updater(prev);
      itemsRef.current = next;
      return next;
    });
  }, []);

  const fetchHistory = useCallback(
    async (mode: "reset" | "merge" | "append") => {
      // append 受并发守卫（滚动高频）；reset/merge 不被拦截（SSE 事件不丢，
      // 乱序由 reqId 兜底）
      if (mode === "append" && loadingRef.current) return;
      loadingRef.current = true;
      if (mode === "append") setIsLoadingMore(true);
      if (mode === "reset") setIsLoading(true);
      const reqId = mode === "append" ? reqIdRef.current : ++reqIdRef.current;
      try {
        // merge 用大窗口保证轮询时能覆盖已加载范围（新记录插顶且旧记录不被清掉）
        const limit = mode === "merge" ? Math.max(pageSize * 3, 100) : pageSize;
        const offset = mode === "append" ? loadedRef.current : 0;
        const res = await fetch(`/api/history?limit=${limit}&offset=${offset}`);
        const json = (await res.json()) as HistoryResponse;

        if (!json.success || !json.data) {
          throw new Error(json.error ?? "获取历史记录失败");
        }
        // 已被更新的基线请求取代 → 丢弃（reqId 校验）
        if (reqId !== reqIdRef.current) return;

        const incoming = json.data;
        const meta = json.pagination;
        setTotal(meta?.total ?? incoming.length);
        setHasMore(meta?.hasMore ?? false);

        const prev = itemsRef.current;
        if (mode === "reset") {
          loadedRef.current = incoming.length;
          applyItems(() => incoming);
        } else if (mode === "append") {
          const seen = new Set(prev.map(recordKey));
          const fresh = incoming.filter((it) => !seen.has(recordKey(it)));
          loadedRef.current += fresh.length;
          applyItems((p) => [...p, ...fresh]);
        } else {
          // merge：新记录插顶，保留已加载的（去重；append 的深页不因轮询丢失）
          const seen = new Set(incoming.map(recordKey));
          const kept = prev.filter((it) => !seen.has(recordKey(it)));
          loadedRef.current = incoming.length + kept.length;
          applyItems(() => [...incoming, ...kept]);
        }
        setError(null);
      } catch (err) {
        if (reqId === reqIdRef.current) {
          setError(err instanceof Error ? err.message : "未知错误");
        }
      } finally {
        if (reqId === reqIdRef.current) {
          loadingRef.current = false;
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [pageSize, applyItems],
  );

  // 首屏
  useEffect(() => {
    void fetchHistory("reset");
  }, [fetchHistory]);

  // SSE 实时刷新：新事件到达 → 重置重拉（顶部出现新记录；不被在飞请求丢弃）
  useEffect(() => {
    if (refreshSignal > 0) void fetchHistory("reset");
  }, [refreshSignal, fetchHistory]);

  // 定时轮询兜底：SSE 断开时事件无重放（内存总线），只能轮询补齐。
  // merge 模式：不打断已滚动位置，新记录插顶。
  useEffect(() => {
    const interval = setInterval(
      () => void fetchHistory("merge"),
      realtimeConnected ? 60_000 : 15_000,
    );
    return () => clearInterval(interval);
  }, [realtimeConnected, fetchHistory]);

  const loadMore = useCallback(() => {
    if (hasMore && !loadingRef.current) void fetchHistory("append");
  }, [hasMore, fetchHistory]);

  return { items, total, isLoading, isLoadingMore, hasMore, error, loadMore };
}
