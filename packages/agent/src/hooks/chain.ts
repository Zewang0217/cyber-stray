/**
 * Hook 执行链
 *
 * 包装 AI SDK Tool 的 execute，在前后插入 hook 调用。
 * 设计原则：
 * - hook 内抛错不阻断游荡（try/catch → warn + allow）
 * - 串行执行，按 priority 顺序
 * - deny 立即短路返回，不执行后续 hook 和工具
 */

import type { Tool } from 'ai';
import { consola } from '../logger.js';
import type { HookContext, HookDefinition } from './types.js';
import type { WanderResult } from '../types.js';
import { loadHooks } from './loader.js';

const logger = consola.withTag('hooks:chain');

export class HookChain {
  private hooks: HookDefinition[] = [];

  /** 初始化：加载 hooks */
  async init(disabledNames?: string[]): Promise<void> {
    this.hooks = await loadHooks(disabledNames);
  }

  /** 获取已加载的 hook 列表（调试用） */
  getHooks(): readonly HookDefinition[] {
    return this.hooks;
  }

  /**
   * 包装 AI SDK tools，在 execute 前后插入 hook 调用。
   * 返回新对象，不修改原始 tools。
   */
  wrapTools(tools: Record<string, Tool>, hookCtx: HookContext): Record<string, Tool> {
    const wrapped: Record<string, Tool> = {};
    for (const [name, tool] of Object.entries(tools)) {
      wrapped[name] = this.wrapTool(name, tool, hookCtx);
    }
    return wrapped;
  }

  /** 执行 onWanderStart hooks */
  async runWanderStart(ctx: HookContext): Promise<void> {
    for (const hook of this.hooks) {
      if (!hook.onWanderStart) continue;
      try {
        await hook.onWanderStart(ctx);
      } catch (error) {
        logger.warn(`Hook ${hook.name} onWanderStart 失败`, { error: String(error) });
      }
    }
  }

  /** 执行 onWanderEnd hooks */
  async runWanderEnd(ctx: HookContext, result: WanderResult): Promise<void> {
    for (const hook of this.hooks) {
      if (!hook.onWanderEnd) continue;
      try {
        await hook.onWanderEnd(ctx, result);
      } catch (error) {
        logger.warn(`Hook ${hook.name} onWanderEnd 失败`, { error: String(error) });
      }
    }
  }

  private wrapTool(name: string, tool: Tool, hookCtx: HookContext): Tool {
    const originalExecute = tool.execute;
    if (!originalExecute) return tool;

    const chain = this;

    return {
      ...tool,
      execute: async (params: unknown, options: Parameters<NonNullable<Tool['execute']>>[1]) => {
        // ─── beforeToolCall ───
        for (const hook of chain.hooks) {
          if (!hook.beforeToolCall) continue;
          try {
            const result = await hook.beforeToolCall(hookCtx, name, params);
            if (result.action === 'deny') {
              hookCtx.emit({
                type: 'tool_call_end',
                tool: name,
                success: false,
                durationMs: 0,
                error: `Blocked by hook "${hook.name}": ${result.reason}`,
              });
              return result.result ?? { error: `Blocked by ${hook.name}: ${result.reason}` };
            }
            if (result.action === 'modify') {
              params = result.params;
            }
          } catch (error) {
            logger.warn(`Hook ${hook.name} beforeToolCall 异常（放行）`, { tool: name, error: String(error) });
          }
        }

        // ─── 执行原始工具 ───
        const start = Date.now();
        hookCtx.emit({ type: 'tool_call_start', tool: name, params });

        let result: unknown;
        let success = true;
        let errorMsg: string | undefined;

        try {
          result = await originalExecute(params as never, options);
        } catch (err) {
          success = false;
          errorMsg = String(err);
          result = { error: errorMsg };
        }

        const durationMs = Date.now() - start;
        hookCtx.emit({ type: 'tool_call_end', tool: name, success, durationMs, error: errorMsg });

        // ─── afterToolCall ───
        for (const hook of chain.hooks) {
          if (!hook.afterToolCall) continue;
          try {
            const modified = await hook.afterToolCall(hookCtx, name, params, result);
            result = modified.result;
          } catch (error) {
            logger.warn(`Hook ${hook.name} afterToolCall 异常（保留原结果）`, { tool: name, error: String(error) });
          }
        }

        return result;
      },
    };
  }
}
