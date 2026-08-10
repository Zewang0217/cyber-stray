/**
 * 游荡事件协议
 *
 * 事件是层间协调契约，不是日志：
 * - Agent 层归约事件 → 更新状态
 * - Harness 层订阅事件 → 持久化
 * - Hook 通过 emit 发事件 → 扩展反应
 * - 日志（consola）是事件的一个 subscriber
 */

import { EventEmitter } from 'node:events';
import type { WanderResult } from '../types.js';

// ─── 事件类型 ───

export type WanderEvent =
  // 生命周期
  | { type: 'wander_start'; traceId: string; maxSteps: number }
  | { type: 'wander_end'; result: WanderResult }
  // 步级（step_start 无稳定 emit 点——AI SDK onStepStart 为 experimental，故不定义）
  | { type: 'step_end'; step: number; action: string }
  // 工具
  | { type: 'tool_call_start'; tool: string; params: unknown }
  | { type: 'tool_call_end'; tool: string; success: boolean; durationMs: number; error?: string }
  // 行为
  | { type: 'speak'; content: string; speakType: string; gated: boolean; score?: number }
  // 错误
  | { type: 'error'; phase: string; error: string; recoverable: boolean };

// ─── Typed Emitter ───

export interface WanderEventMap {
  event: [WanderEvent];
}

/**
 * 类型安全的事件发射器。
 * 统一 'event' 通道，subscriber 按 event.type 自行分发。
 */
export class WanderEventEmitter extends EventEmitter<WanderEventMap> {
  emitEvent(event: WanderEvent): void {
    this.emit('event', event);
  }
}

/**
 * 传给 wanderLoop 的 emit 函数签名。
 * loop 不持有 emitter 实例，只拿到一个函数——保持纯。
 */
export type EmitFn = (event: WanderEvent) => void;

/** 空 emit（测试/无订阅者时使用） */
export const noopEmit: EmitFn = () => {};
