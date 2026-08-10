/**
 * Hook 系统类型定义
 *
 * Hook 是工具执行前后的通用拦截点：
 * - beforeToolCall：可拦截（deny）、可修改参数（modify）
 * - afterToolCall：可修改结果
 * - 生命周期：onWanderStart / onWanderEnd
 *
 * 注册方式：目录扫描自动发现（hooks/ 下每个文件 export default HookDefinition）
 */

import type { AgentState, AgentConfig, WanderResult } from '../types.js';
import type { EmitFn } from '../core/events.js';
import type { ToolContext } from '../tools/registry/context.js';

/** Hook 执行上下文 */
export interface HookContext {
  traceId: string;
  state: Readonly<AgentState>;
  config: Readonly<AgentConfig>;
  emit: EmitFn;
  /** 本次游荡的可变工具上下文（与工具共享同一实例，hooks 可直接修改 endReason 等） */
  toolCtx: ToolContext;
  /** 每轮游荡的临时数据空间（hook 间共享 before/after 状态） */
  data: Record<string, unknown>;
}

/** beforeToolCall 返回值 */
export type BeforeToolCallResult =
  | { action: 'allow' }
  | { action: 'deny'; reason: string; result?: unknown }
  | { action: 'modify'; params: unknown };

/** afterToolCall 返回值 */
export interface AfterToolCallResult {
  result: unknown;
}

/**
 * Hook 定义接口。
 * 每个 hook 文件 export default 一个满足此接口的对象。
 */
export interface HookDefinition {
  /** 唯一标识（用于配置禁用） */
  name: string;
  /** 执行优先级，数字小的先执行 */
  priority: number;

  /** 工具执行前：可拦截、可修改参数 */
  beforeToolCall?(ctx: HookContext, tool: string, params: unknown): Promise<BeforeToolCallResult>;

  /** 工具执行后：可修改结果 */
  afterToolCall?(ctx: HookContext, tool: string, params: unknown, result: unknown): Promise<AfterToolCallResult>;

  /** 游荡开始时 */
  onWanderStart?(ctx: HookContext): Promise<void>;

  /** 游荡结束时 */
  onWanderEnd?(ctx: HookContext, result: WanderResult): Promise<void>;
}
