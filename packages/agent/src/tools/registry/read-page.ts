import { tool } from 'ai';
import { z } from 'zod';
import { consola } from '../../logger.js';
import { readPage } from '../page/reader.js';
import { pushWanderStep, type ToolContext } from './context.js';
import type { ToolDefinition } from '../tool-manager.js';

const logger = consola.withTag('tool:read_page');

const READ_PAGE_DESCRIPTION = '点开一个链接，阅读网页内容，看看里面有什么';

/** 读取页面工具定义 */
export const readPageToolDef: ToolDefinition = {
  metadata: {
    name: 'read_page',
    description: READ_PAGE_DESCRIPTION,
    category: 'web',
  },
  createTool: (ctx: ToolContext) => tool({
    description: READ_PAGE_DESCRIPTION,
    inputSchema: z.object({
      url: z.string().url().describe('要阅读的网页地址'),
    }),
    execute: async ({ url }) => {
      ctx.stepCount++;
      const stepStart = Date.now();

      const result = await readPage(url);
      const elapsed = Date.now() - stepStart;

      if (result.error) {
        logger.warn(`[${ctx.traceId}] TOOL read [url=${url} success=false elapsed=${elapsed}ms] ${result.error}`);
      } else {
        ctx.visitedUrls.push(url);
        logger.info(`[${ctx.traceId}] TOOL read [url=${url} title="${result.title.slice(0, 30)}" elapsed=${elapsed}ms]`);
      }

      pushWanderStep(ctx, {
        timestamp: new Date().toISOString(),
        tool: 'read_page',
        url,
        thought: result.error ? `读取失败: ${result.error}` : `读取: ${result.title}`,
      });

      return result;
    },
  }),
};

/** 向后兼容别名 */
export const createReadPageTool = (ctx: ToolContext) => readPageToolDef.createTool(ctx);
