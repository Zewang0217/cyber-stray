/**
 * 新 Tool 模板
 *
 * 使用步骤：
 * 1. 复制此文件为新 Tool 名称（如 my-tool.ts）
 * 2. 修改 description、inputSchema、execute
 * 3. 在 registry/index.ts 中的 createTools() 里注册
 * 4. （可选）在 prompts/react.ts 中添加 Tool 说明
 */

import { tool } from 'ai';
import { z } from 'zod';
import { consola } from '../../logger.js';
import { pushWanderStep, type ToolContext } from './context.js';

const logger = consola.withTag('tool:xxx');

export function createXxxTool(ctx: ToolContext) {
  return tool({
    description: 'TODO: 描述这个 Tool 的用途',
    inputSchema: z.object({
      // TODO: 定义输入参数
      param: z.string().describe('参数说明'),
    }),
    execute: async ({ param }) => {
      ctx.stepCount++;
      logger.info(`[Step ${ctx.stepCount}] xxx`, { param });

      // TODO: 实现核心逻辑

      pushWanderStep(ctx, {
        timestamp: new Date().toISOString(),
        tool: 'xxx',
        thought: `TODO: 内心独白`,
      });

      return {
        // TODO: 返回结果
      };
    },
  });
}
