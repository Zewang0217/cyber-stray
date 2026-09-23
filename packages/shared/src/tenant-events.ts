/**
 * 租户实时事件（SSE 契约）：CP 事件总线发布，web 订阅 /api/events 消费。
 * 总线是进程内存、无重放——断线重连会丢中间事件，前端靠刷新信号 + 轮询兜底。
 */

export interface TenantEvent {
  type:
    | 'pet_ready'
    | 'worker_started'
    | 'worker_succeeded'
    | 'worker_retry'
    | 'worker_failed'
    | 'worker_timeout'
    /** 日记生成（睡前任务；Web Push 消费） */
    | 'diary_generated'
    /** 今日 LLM 预算耗尽，停派发（租户侧语义「宠物在睡觉」；detail = 水位/上限） */
    | 'budget_exhausted'
    /** 恢复派发（次日归零或 admin 调高阈值），转变沿发一次 */
    | 'budget_resumed'
    /** 当日用量读取失败，fail-closed 停派（detail = 错误信息） */
    | 'budget_check_failed'
    /** 领养超 24h 且首推仍未送达任何设备（进程内去重；detail = 说明） */
    | 'first_push_overdue';
  tenantId: string;
  petId: string;
  /** 事件时刻（unix ms） */
  at: number;
  /** 附加信息（失败原因、预算水位等） */
  detail?: string;
}
