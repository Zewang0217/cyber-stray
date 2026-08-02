/**
 * Dedup Hook — URL 冷却期检查
 *
 * 迁移自 read-page.ts 的 cooldown 逻辑（L37-39, L58-66）。
 * beforeToolCall：检查 URL 是否在冷却期，存入 ctx.data。
 * afterToolCall：若在冷却期，附加 visited 提示到结果。
 *
 * 行为不变：仍然读取页面，只是返回时附加"之前访问过"的提示。
 */

import type { HookDefinition } from './types.js';
import { isInCooldown, getVisitedInfo } from '../tools/dedup/url-tracker.js';

export default {
  name: 'dedup',
  priority: 50,

  async beforeToolCall(ctx, tool, params) {
    if (tool !== 'read_page') return { action: 'allow' };

    const url = (params as { url?: string }).url;
    if (!url) return { action: 'allow' };

    const inCooldown = await isInCooldown(url, ctx.config.urlCooldownDays);
    const visitedInfo = await getVisitedInfo(url);

    // 存入 data，afterToolCall 读取
    ctx.data[`dedup:${url}`] = { inCooldown, visitedInfo };

    return { action: 'allow' };
  },

  async afterToolCall(ctx, tool, params, result) {
    if (tool !== 'read_page') return { result };

    const url = (params as { url?: string }).url;
    if (!url) return { result };

    const cached = ctx.data[`dedup:${url}`] as
      | { inCooldown: boolean; visitedInfo: { lastContent?: string } | null }
      | undefined;

    if (cached?.inCooldown && cached.visitedInfo) {
      return {
        result: {
          ...(result as Record<string, unknown>),
          visited: true,
          lastContent: cached.visitedInfo.lastContent,
          message: `该 URL 之前已访问过。上次推送内容：${cached.visitedInfo.lastContent || '无内容摘要'}`,
        },
      };
    }

    return { result };
  },
} satisfies HookDefinition;
