import { tool } from 'ai';
import { z } from 'zod';
import { consola } from '../../logger.js';
import { config } from '../../config.js';
import { readPage } from '../page/reader.js';
import { pushWanderStep, type ToolContext } from './context.js';

const logger = consola.withTag('tool:read_page');

export function createReadPageTool(ctx: ToolContext) {
  return tool({
    description: '点开一个链接，阅读网页内容，看看里面有什么',
    inputSchema: z.object({
      url: z.string().url().describe('要阅读的网页地址'),
    }),
    execute: async ({ url }) => {
      ctx.stepCount++;
      logger.info(`[Step ${ctx.stepCount}] read_page`, { url });

      // 强制结束条件：精力过低
      if (ctx.state.energy < config.energyThreshold) {
        logger.warn('精力不足，跳过 read_page', { energy: ctx.state.energy });
        ctx.endReason = 'low_energy';
        return { url, title: '', content: '', links: [], error: '精力不足，无法继续游荡' };
      }

      const result = await readPage(url);

      if (result.error) {
        logger.warn('read_page 失败', { url, error: result.error });
      } else {
        ctx.visitedUrls.push(url);
      }

      pushWanderStep(ctx, {
        timestamp: new Date().toISOString(),
        tool: 'read_page',
        url,
        thought: result.error ? `读取失败: ${result.error}` : `读取: ${result.title}`,
      });

      return result;
    },
  });
}
