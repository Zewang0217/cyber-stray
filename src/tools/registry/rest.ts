import { tool } from 'ai';
import { z } from 'zod';
import { consola } from '../../logger.js';
import { pushWanderStep, type ToolContext } from './context.js';
import type { ToolDefinition } from '../tool-manager.js';

const logger = consola.withTag('tool:rest');

const REST_DESCRIPTION = '游荡累了或者心满意足了，结束这次漫游';

/** 休息工具定义 */
export const restToolDef: ToolDefinition = {
  metadata: {
    name: 'rest',
    description: REST_DESCRIPTION,
    category: 'content',
  },
  createTool: (ctx: ToolContext) => tool({
    description: REST_DESCRIPTION,
    inputSchema: z.object({}),
    execute: async () => {
      ctx.stepCount++;
      const elapsed = Date.now() - ctx.startTime;
      logger.info(`[${ctx.traceId}] TOOL rest [steps=${ctx.stepCount} duration=${elapsed}ms reason=rest]`);
      ctx.endReason = 'rest';

      pushWanderStep(ctx, {
        timestamp: new Date().toISOString(),
        tool: 'rest',
        thought: '主动结束游荡',
      });

      return {
        message: '游荡结束，溜回去了',
        steps: ctx.stepCount,
        durationMs: elapsed,
      };
    },
  }),
};

/** 向后兼容别名 */
export const createRestTool = (ctx: ToolContext) => restToolDef.createTool(ctx);
