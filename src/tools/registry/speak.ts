import { tool } from 'ai';
import { z } from 'zod';
import { consola } from '../../logger.js';
import { speak } from '../push/speak.js';
import { pushWanderStep, type ToolContext } from './context.js';

const logger = consola.withTag('tool:speak');

export function createSpeakTool(ctx: ToolContext) {
  return tool({
    description: '分享内容或者碎碎念，表达你的想法',
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
