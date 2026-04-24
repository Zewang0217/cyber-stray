import { tool } from 'ai';
import { z } from 'zod';
import { consola } from '../../logger.js';
import { config } from '../../config.js';
import { search, premiumSearch } from '../search/index.js';
import { pushWanderStep, type ToolContext } from './context.js';

const logger = consola.withTag('tool:search_web');

export function createSearchWebTool(ctx: ToolContext) {
  return tool({
    description: `搜索互联网获取信息。

**搜索策略：**
- free：免费搜索，适合百科知识、概念解释、历史事件等静态内容
- premium：实时搜索，适合新闻热点、最新动态、技术趋势等时效性内容

**双语搜索技巧：**
1. **英文优先**：技术、科学、国际新闻用英文搜索结果更丰富
2. **中文补充**：国内动态、政策解读、本地热点用中文搜索更准确
3. **混合策略**：重要话题建议用两种语言分别搜索，汇总信息更全面
4. **关键词优化**：
   - 英文：简洁关键词，如 "AI trends 2024"、"GPT-5 release"
   - 中文：完整短语，如 "最新人工智能进展"、"ChatGPT 最新功能"

**示例：**
- 搜技术趋势：query="latest AI developments", quality="premium"
- 搜百科知识：query="quantum computing basics", quality="free"
- 搜国内新闻：query="中国新能源汽车市场", quality="premium"`,
    inputSchema: z.object({
      query: z.string().describe('搜索关键词'),
      quality: z.enum(['free', 'premium']).default('free').describe(
        'free=免费搜索（百科类内容）, premium=实时/深度搜索（新闻、最新动态）',
      ),
    }),
    execute: async ({ query, quality }) => {
      ctx.stepCount++;
      logger.info(`[Step ${ctx.stepCount}] search_web`, { query, quality });

      try {
        const results = quality === 'premium'
          ? await premiumSearch(query, { maxResults: config.maxSearchResults })
          : await search(query, { adapter: 'duckduckgo', maxResults: config.maxSearchResults });

        pushWanderStep(ctx, {
          timestamp: new Date().toISOString(),
          tool: 'search_web',
          thought: `搜索(${quality}): ${query}`,
        });

        return {
          results: results.map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.content.slice(0, 200),
          })),
          total: results.length,
          quality,
        };
      } catch (error) {
        logger.error('search_web 执行失败', { query, quality, error });
        return { results: [], total: 0, error: String(error) };
      }
    },
  });
}
