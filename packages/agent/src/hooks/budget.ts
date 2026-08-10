/**
 * Budget Hook — 精力/步数预算守卫
 *
 * 迁移自 read-page.ts 的精力检查（L31-35）。
 * 精力低于阈值时拒绝 read_page，设置 endReason = 'low_energy'。
 */

import type { HookDefinition } from './types.js';

export const budgetHook = {
  name: 'budget',
  priority: 10,

  async beforeToolCall(ctx, tool, params) {
    if (tool !== 'read_page') return { action: 'allow' };

    if (ctx.state.energy < ctx.config.energyThreshold) {
      // 等价旧 read-page.ts：stepCount++ 在能量检查之前，deny 也算一步
      ctx.toolCtx.stepCount++;
      // 设置 endReason，loop 结束时从 toolCtx 读取
      ctx.toolCtx.endReason = 'low_energy';

      const url = (params as { url?: string }).url ?? '';
      return {
        action: 'deny',
        reason: '精力不足',
        result: { url, title: '', content: '', links: [], error: '精力不足，无法继续游荡' },
      };
    }

    return { action: 'allow' };
  },
} satisfies HookDefinition;
