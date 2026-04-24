import { tool } from 'ai';
import { z } from 'zod';
import { consola } from '../../logger.js';
import { config } from '../../config.js';
import { search } from '../search/index.js';
import { pushWanderStep, type ToolContext } from './context.js';

const logger = consola.withTag('tool:search_web');

export function createSearchWebTool(ctx: ToolContext) {
  return tool({
    description: '搜索互联网，嗅一嗅有什么有趣的东西',
    inputSchema: z.object({
      query: z.string().describe('搜索关键词，你想搜什么'),
    }),
    execute: async ({ query }) => {
      ctx.stepCount++;
      logger.info(`[Step ${ctx.stepCount}] search_web`, { query });

      try {
        const results = await search(query, { maxResults: config.maxSearchResults });

        pushWanderStep(ctx, {
          timestamp: new Date().toISOString(),
          tool: 'search_web',
          thought: `搜索: ${query}`,
        });

        return {
          results: results.map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.content.slice(0, 200),
          })),
          total: results.length,
        };
      } catch (error) {
        logger.error('search_web 执行失败', { query, error });
        return { results: [], total: 0, error: String(error) };
      }
    },
  });
}
