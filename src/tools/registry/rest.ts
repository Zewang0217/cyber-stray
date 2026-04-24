import { tool } from 'ai';
import { z } from 'zod';
import { consola } from '../../logger.js';
import { pushWanderStep, type ToolContext } from './context.js';

const logger = consola.withTag('tool:rest');

export function createRestTool(ctx: ToolContext) {
  return tool({
    description: '游荡累了或者心满意足了，结束这次漫游',
    inputSchema: z.object({}),
    execute: async () => {
      ctx.stepCount++;
      logger.info(`[Step ${ctx.stepCount}] rest — 游荡结束`);
      ctx.endReason = 'rest';

      pushWanderStep(ctx, {
        timestamp: new Date().toISOString(),
        tool: 'rest',
        thought: '主动结束游荡',
      });

      return {
        message: '游荡结束，溜回去了',
        steps: ctx.stepCount,
        durationMs: Date.now() - ctx.startTime,
      };
    },
  });
}
