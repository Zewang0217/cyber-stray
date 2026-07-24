"use client";

import { useEffect, useState } from "react";
import type {
  InterestNodeData,
  InterestSnapshot,
  InterestGraphResponse,
  CollapseDetection,
  ApiResponse,
} from "@/lib/types";

interface UseInterestGraphReturn {
  /** 当前兴趣节点 */
  nodes: InterestNodeData[];
  /** 当前熵值 */
  entropy: number;
  /** 节点数量 */
  nodeCount: number;
  /** 最后更新时间 */
  lastUpdated: string | null;
  /** 权重历史时间序列 */
  history: InterestSnapshot[];
  /** 坍缩检测结果 */
  collapse: CollapseDetection;
  /** 加载中 */
  isLoading: boolean;
  /** 错误信息 */
  error: string | null;
}

/** 坍缩告警阈值：熵 < 1.0 且节点 > 3 时触发 */
const COLLAPSE_ENTROPY_THRESHOLD = 1.0;
const COLLAPSE_MIN_NODES = 3;

/**
 * 检测兴趣是否正在坍缩
 */
function detectCollapse(entropy: number, nodeCount: number): CollapseDetection {
  const maxEntropy = nodeCount > 0 ? Math.log2(nodeCount) : 0;
  const isCollapsing =
    nodeCount > COLLAPSE_MIN_NODES && entropy < COLLAPSE_ENTROPY_THRESHOLD;

  let warning: string | null = null;
  if (isCollapsing) {
    warning = `兴趣分布极不均匀：熵 ${entropy.toFixed(2)} / 最大 ${maxEntropy.toFixed(2)}。存在坍缩风险。`;
  }

  return { isCollapsing, entropy, maxEntropy, warning };
}

/**
 * 获取兴趣图谱数据的 Hook
 * 每 30 秒轮询（比 Agent 状态慢，兴趣变化较缓慢）
 */
export function useInterestGraph(): UseInterestGraphReturn {
  const [nodes, setNodes] = useState<InterestNodeData[]>([]);
  const [entropy, setEntropy] = useState(0);
  const [nodeCount, setNodeCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [history, setHistory] = useState<InterestSnapshot[]>([]);
  const [collapse, setCollapse] = useState<CollapseDetection>({
    isCollapsing: false,
    entropy: 0,
    maxEntropy: 0,
    warning: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async (): Promise<void> => {
      try {
        // 并行获取当前状态和历史
        const [currentRes, historyRes] = await Promise.all([
          fetch("/api/interests"),
          fetch("/api/interests/history?limit=30"),
        ]);

        const currentJson =
          (await currentRes.json()) as ApiResponse<InterestGraphResponse>;
        const historyJson =
          (await historyRes.json()) as ApiResponse<InterestSnapshot[]>;

        if (currentJson.success && currentJson.data) {
          setNodes(currentJson.data.nodes);
          setEntropy(currentJson.data.entropy);
          setNodeCount(currentJson.data.nodeCount);
          setLastUpdated(currentJson.data.lastUpdated);
          setCollapse(
            detectCollapse(
              currentJson.data.entropy,
              currentJson.data.nodeCount,
            ),
          );
        } else {
          throw new Error(currentJson.error ?? "获取兴趣图谱失败");
        }

        if (historyJson.success && historyJson.data) {
          setHistory(historyJson.data);
        }

        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "未知错误");
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
    // 30 秒轮询（兴趣变化较缓慢）
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  return {
    nodes,
    entropy,
    nodeCount,
    lastUpdated,
    history,
    collapse,
    isLoading,
    error,
  };
}
