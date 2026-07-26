/**
 * browse_page - 在浏览器中打开网页并读取渲染后的内容
 *
 * 映射 agent-browser CLI：`open <url>` + `read`
 */

import { tool } from 'ai';
import { z } from 'zod';
import { consola } from '../../../logger.js';
import { pushWanderStep, type ToolContext } from '../../registry/context.js';
import type { ToolDefinition } from '../../tool-manager.js';
import { getBrowserExecutor } from '../executor.js';
import { updateBrowserContext } from '../lifecycle.js';

const logger = consola.withTag('tool:browse_page');

const DESCRIPTION =
  '在浏览器中打开一个网页，等待加载完成后读取页面内容。比 read_page 更强大——能处理需要 JavaScript 渲染的页面、需要登录的页面。';

export const browsePageToolDef: ToolDefinition = {
  metadata: {
    name: 'browse_page',
    description: DESCRIPTION,
    category: 'browser',
  },
  createTool: (ctx: ToolContext) =>
    tool({
      description: DESCRIPTION,
      inputSchema: z.object({
        url: z.string().describe('要访问的网页地址'),
      }),
      execute: async ({ url }) => {
        ctx.stepCount++;
        const executor = getBrowserExecutor();

        // 1. 导航到目标 URL
        const openResult = await executor.execute('open', [url]);
        if (!openResult.success) {
          logger.warn(`[${ctx.traceId}] TOOL browse_page [url=${url}] 打开失败: ${openResult.error}`);
          pushWanderStep(ctx, {
            timestamp: new Date().toISOString(),
            tool: 'browse_page',
            url,
            thought: `打开失败: ${openResult.error}`,
          });
          return { url, error: openResult.error ?? '打开页面失败' };
        }

        // 2. 读取渲染后的内容
        const readResult = await executor.execute('read', []);
        if (!readResult.success) {
          logger.warn(`[${ctx.traceId}] TOOL browse_page [url=${url}] 读取失败: ${readResult.error}`);
          pushWanderStep(ctx, {
            timestamp: new Date().toISOString(),
            tool: 'browse_page',
            url,
            thought: `读取失败: ${readResult.error}`,
          });
          return { url, error: readResult.error ?? '读取页面内容失败' };
        }

        const title = openResult.data?.title as string | undefined;
        logger.info(`[${ctx.traceId}] TOOL browse_page [url=${url} title="${(title ?? '').slice(0, 30)}"]`);

        // 更新浏览器上下文（跨游荡持久）
        updateBrowserContext({ currentUrl: url, currentPageTitle: title });

        ctx.visitedUrls.push(url);
        pushWanderStep(ctx, {
          timestamp: new Date().toISOString(),
          tool: 'browse_page',
          url,
          thought: `浏览: ${title ?? url}`,
        });

        return {
          url,
          title,
          content: readResult.data?.content,
          truncated: readResult.data?.truncated,
        };
      },
    }),
};
