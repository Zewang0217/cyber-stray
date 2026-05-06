import { tool } from 'ai';
import { z } from 'zod';
import { consola } from '../../logger.js';
import { recordKnowledge } from '../../memory/long-term.js';
import { pushWanderStep, type ToolContext } from './context.js';

const logger = consola.withTag('tool:record_knowledge');

export function createRecordKnowledgeTool(ctx: ToolContext) {
  return tool({
    description: `将发现有价值的知识存入长期记忆，供未来游荡时参考。

**使用时机：**
- read_page 后发现了值得记住的事实、概念、技术细节
- 对后续搜索和决策有帮助的背景知识
- 纠正了之前错误认知的新发现

**不应使用：**
- 纯新闻标题和时效性内容（过几天就没用了）
- 搜索引擎返回的碎片化摘要
- 已经在已有知识中重复的内容
- 未经 read_page 验证的推测`,
    inputSchema: z.object({
      title: z.string().describe('知识标题，简洁概括'),
      content: z.string().describe('知识正文，包含关键事实和理解'),
      source_url: z.string().url().describe('来源网页 URL（必填，用于回溯验证）'),
      tags: z.array(z.string()).optional().describe('分类标签，如 ["AI", "编程"]'),
    }),
    execute: async ({ title, content, source_url, tags }) => {
      ctx.stepCount++;
      logger.info(`[Step ${ctx.stepCount}] record_knowledge`, { title, source_url });

      try {
        const entry = await recordKnowledge({
          topic: tags?.[0] || 'general',
          title,
          content,
          source: source_url,
          url: source_url,
        });

        pushWanderStep(ctx, {
          timestamp: new Date().toISOString(),
          tool: 'record_knowledge',
          thought: `记住了: ${title}`,
          url: source_url,
        });

        return {
          saved: true,
          id: entry.id,
          summary: entry.summary,
        };
      } catch (error) {
        logger.error('record_knowledge 失败', { title, error });
        return { saved: false, error: String(error) };
      }
    },
  });
}
