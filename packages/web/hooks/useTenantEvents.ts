"use client";

import { useEffect, useState } from "react";
import type { TenantEvent } from "@cyber-stray/shared/tenant-events";

/** 事件形状契约在 shared/tenant-events（CP 事件总线同源） */
export type { TenantEvent };

/** worker 生命周期事件 = 一轮游荡可能改了状态/兴趣/推送历史；
 * 预算事件一并刷新：budgetPaused 的真相源是 CP pets GET（SSE 只给转变沿） */
const REFRESH_EVENT_TYPES = new Set<TenantEvent["type"]>([
  "worker_succeeded",
  "worker_failed",
  "worker_timeout",
  "worker_retry",
  "diary_generated",
  "budget_exhausted",
  "budget_resumed",
]);

interface UseTenantEventsReturn {
  /** SSE 是否连通（EventSource open 且未掉线） */
  connected: boolean;
  /**
   * 自上次消费以来的刷新信号（worker 生命周期事件计数）。
   * 消费方（useAgentState/useHistory/useInterestGraph）据此立即拉取——
   * SSE 稳定时取代定时轮询，SSE 断开时消费方回落到自身轮询兜底。
   */
  refreshSignal: number;
  /** 最近一次事件(驱动宠物状态动画:游荡/进食/庆祝等) */
  lastEvent: TenantEvent | null;
}

/**
 * 租户实时事件：EventSource 订阅 /api/events（cookie 鉴权；租户由
 * session claim 决定，服务端隔离）。
 *
 * 降级：连接失败/中断 → connected=false，消费方回落轮询；EventSource
 * 自带重连（服务端 retry: 5000），恢复后重新 connected=true。
 */
export function useTenantEvents(options: { enabled?: boolean } = {}): UseTenantEventsReturn {
  const { enabled = true } = options;
  const [connected, setConnected] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [lastEvent, setLastEvent] = useState<TenantEvent | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource("/api/events");

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (ev: MessageEvent<string>) => {
      try {
        const event = JSON.parse(ev.data) as TenantEvent;
        setLastEvent(event);
        if (REFRESH_EVENT_TYPES.has(event.type)) {
          setRefreshSignal((n) => n + 1);
        }
      } catch {
        // malformed 帧：忽略（心跳注释行不会进 onmessage）
      }
    };

    return () => source.close();
  }, [enabled]);

  return { connected, refreshSignal, lastEvent };
}
