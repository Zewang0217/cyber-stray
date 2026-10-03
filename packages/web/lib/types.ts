/**
 * web 专有类型：CP API 信封 / 分页、兴趣响应投影、坍缩检测（前端纯派生）。
 * 跨包数据契约一律在 @cyber-stray/shared（agent-state / push / petgen /
 * interest-graph / tenant-events / sleep / session），此处不重复定义。
 */

import type { InterestNode } from "@cyber-stray/shared/interest-graph";

/** CP API 通用响应包装 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/** 分页元数据（history 等列表接口） */
export interface PaginationMeta {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

/** GET /api/interests 响应（nodes = shared InterestNode 原样透传） */
export interface InterestGraphResponse {
  nodes: InterestNode[];
  entropy: number;
  nodeCount: number;
  lastUpdated: string | null;
}

/** 兴趣坍缩检测（前端派生：熵 < 1.0 且节点 > 3 时告警） */
export interface CollapseDetection {
  isCollapsing: boolean;
  entropy: number;
  maxEntropy: number;
  warning: string | null;
}
