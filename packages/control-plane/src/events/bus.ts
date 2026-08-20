/**
 * 租户事件总线（S5，为 S8 SSE 预留）
 *
 * 事件按 tenantId 路由：订阅者只收本租户事件。发布同步、订阅者隔离。
 *
 * 约束（S8 接 SSE 前须知）：纯进程内存——订阅前发布的事件不可重放
 * （SSE 断线重连丢中间事件）；多实例部署下事件与调度器状态会跨实例
 * 分叉，多实例前需总线外置（如 Redis）+ DB 级租约。
 * S8 接法：SSE 路由 `bus.subscribe(tenantId, (ev) => stream.write(ev))`。
 * S10 接法：推送分发器 `bus.subscribeAll(ev => dispatchPush(ev))`。
 */

/** 控制面事件（调度器目前是唯一发布方；S8 SSE / S10 推送消费） */
export interface TenantEvent {
  type:
    | 'pet_ready'
    | 'worker_started'
    | 'worker_succeeded'
    | 'worker_retry'
    | 'worker_failed'
    | 'worker_timeout'
    /** #92 日记：睡前任务生成当天日记（Web Push 消费） */
    | 'diary_generated';
  tenantId: string;
  petId: string;
  /** 事件时刻（unix ms） */
  at: number;
  /** 附加信息（如失败原因） */
  detail?: string;
}

export type TenantEventHandler = (event: TenantEvent) => void;

/** 退订函数 */
export type Unsubscribe = () => void;

export interface EventBus {
  /** 发布事件到指定租户通道（同步派发；wildcard 订阅者也收到） */
  publish(tenantId: string, event: TenantEvent): void;
  /** 订阅租户通道；返回退订函数 */
  subscribe(tenantId: string, handler: TenantEventHandler): Unsubscribe;
  /** 订阅全部租户通道（S10 推送分发器用）；返回退订函数 */
  subscribeAll(handler: TenantEventHandler): Unsubscribe;
}

export function createEventBus(): EventBus {
  const channels = new Map<string, Set<TenantEventHandler>>();
  const wildcard = new Set<TenantEventHandler>();

  /** 单个 handler 的隔离派发（抛错不传染） */
  function dispatch(handler: TenantEventHandler, tenantId: string, event: TenantEvent): void {
    try {
      handler(event);
    } catch (error) {
      // 订阅者隔离：单个订阅者抛错不传染（其余订阅者照常、发布方不炸）
      console.error(
        `[events] 租户 ${tenantId} 的订阅者抛错：`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return {
    publish(tenantId, event) {
      const handlers = channels.get(tenantId);
      if (handlers) {
        for (const handler of handlers) dispatch(handler, tenantId, event);
      }
      for (const handler of wildcard) dispatch(handler, tenantId, event);
    },

    subscribe(tenantId, handler) {
      let handlers = channels.get(tenantId);
      if (!handlers) {
        handlers = new Set();
        channels.set(tenantId, handlers);
      }
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
        if (handlers.size === 0) channels.delete(tenantId);
      };
    },

    subscribeAll(handler) {
      wildcard.add(handler);
      return () => wildcard.delete(handler);
    },
  };
}
