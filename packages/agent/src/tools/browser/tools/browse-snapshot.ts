/**
 * browse_snapshot - 获取当前页面的可交互元素结构（无障碍树）
 *
 * 映射 agent-browser CLI：`snapshot -i` / `snapshot -s <selector>`
 */

import { tool } from 'ai';
import { z } from 'zod';
import { consola } from '../../../logger.js';
import { pushWanderStep, type ToolContext } from '../../registry/context.js';
import type { ToolDefinition } from '../../tool-manager.js';
import { getBrowserExecutor } from '../executor.js';

const logger = consola.withTag('tool:browse_snapshot');

const DESCRIPTION =
  '获取当前浏览器页面的可交互元素结构（无障碍树）。返回带 ref 标记的元素列表（如 @e1, @e2），可用 browse_act 的 click/fill 操作这些元素。';

export const browseSnapshotToolDef: ToolDefinition = {
  metadata: {
    name: 'browse_snapshot',
    description: DESCRIPTION,
    category: 'browser',
  },
  createTool: (ctx: ToolContext) =>
    tool({
      description: DESCRIPTION,
      inputSchema: z.object({
        interactive: z
          .boolean()
          .optional()
          .default(true)
          .describe('是否只显示可交互元素'),
        selector: z.string().optional().describe('CSS 选择器，限定快照范围'),
      }),
      execute: async ({ interactive, selector }) => {
        ctx.stepCount++;
        const executor = getBrowserExecutor();

        const args: string[] = [];
        if (interactive) args.push('-i');
        if (selector) args.push('-s', selector);

        const result = await executor.execute('snapshot', args);
        if (!result.success) {
          logger.warn(`[${ctx.traceId}] TOOL browse_snapshot 失败: ${result.error}`);
          pushWanderStep(ctx, {
            timestamp: new Date().toISOString(),
            tool: 'browse_snapshot',
            thought: `快照失败: ${result.error}`,
          });
          return { error: result.error ?? '获取页面快照失败' };
        }

        logger.info(`[${ctx.traceId}] TOOL browse_snapshot [interactive=${interactive}]`);
        pushWanderStep(ctx, {
          timestamp: new Date().toISOString(),
          tool: 'browse_snapshot',
          thought: selector ? `快照范围: ${selector}` : '获取页面快照',
        });

        return {
          snapshot: result.data?.snapshot,
          refs: result.data?.refs,
          url: result.data?.origin,
        };
      },
    }),
};
