import { tool } from 'ai';
import { z } from 'zod';
import { consola } from '../../logger.js';
import { config } from '../../config.js';
import { speak } from '../push/speak.js';
import { pushWanderStep, type ToolContext } from './context.js';

const logger = consola.withTag('tool:speak');

export function createSpeakTool(ctx: ToolContext) {
  return tool({
    description: `分享内容或者碎碎念，表达你的想法。

**语言要求：** 推送内容应使用 ${config.outputLanguage} 语言。即使你搜索时用了英文/中文，最终分享时应整理为指定语言。

**内容类型：**
- share：分享链接/资源，建议包含 URL 和简要说明
- nonsense：无厘头碎碎念，可以是短句或感叹
- article：正经文章/评论，可以是长篇分析或观点表达`,
    inputSchema: z.object({
      content: z.string().describe('你要说的话、分享的内容或者碎碎念'),
      type: z.enum(['share', 'nonsense', 'article']).describe(
        'share=分享链接/资源, nonsense=无厘头碎碎念, article=正经文章/评论',
      ),
    }),
    execute: async ({ content, type }) => {
      ctx.stepCount++;
      logger.info(`[Step ${ctx.stepCount}] speak`, { type, contentLength: content.length });

      const result = await speak(content, type);
      ctx.spokeTimes++;

      pushWanderStep(ctx, {
        timestamp: new Date().toISOString(),
        tool: 'speak',
        spoke: content,
        thought: `[${type}] 表达了想法`,
      });

      return result;
    },
  });
}
