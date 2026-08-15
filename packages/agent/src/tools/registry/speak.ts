import { tool } from 'ai';
import { z } from 'zod';
import { consola } from '../../logger.js';
import { getConfig } from '../../config.js';
import { speak } from '../push/speak.js';
import { pushWanderStep, type ToolContext } from './context.js';
import type { ToolDefinition } from '../tool-manager.js';

const logger = consola.withTag('tool:speak');

/** 按当前生效配置构建描述（outputLanguage 可能因租户而异，不能模块加载期定格） */
function buildSpeakDescription(): string {
  return `分享内容或者碎碎念，表达你的想法。

**语言要求：** 推送内容应使用 ${getConfig().outputLanguage} 语言。即使你搜索时用了英文/中文，最终分享时应整理为指定语言。

**内容类型：**
- share：分享链接/资源。**必须包含原始 URL**（http/https 开头），附带简要说明。没有 URL 就不要用 share 类型。
- nonsense：无厘头碎碎念，可以是短句或感叹
- article：正经文章/评论，可以是长篇分析或观点表达。如果引用了具体来源，也应附带 URL。`;
}

/** 发言工具定义 */
export const speakToolDef: ToolDefinition = {
  metadata: {
    name: 'speak',
    description: buildSpeakDescription(),
    category: 'content',
  },
  createTool: (ctx: ToolContext) => tool({
    description: buildSpeakDescription(),
    inputSchema: z.object({
      content: z.string().describe('你要说的话、分享的内容或者碎碎念'),
      type: z.enum(['share', 'nonsense', 'article']).describe(
        'share=分享链接/资源, nonsense=无厘头碎碎念, article=正经文章/评论',
      ),
    }),
    execute: async ({ content, type }) => {
      ctx.stepCount++;
      const stepStart = Date.now();

// 门控评估在 quality hook 的 beforeToolCall 完成，命中的兴趣话题已写入 ctx.matchedTopics。
      // 门控拦截由 hook 侧 deny 处理（含 gated 历史留痕），工具 execute 只走放行路径。
      const result = await speak(content, type, {
        mood: ctx.state.mood,
        gateReasons: ctx.gateReasons,
        matchedTopics: ctx.matchedTopics,
      });
      const elapsed = Date.now() - stepStart;
      ctx.spokeTimes++;

      logger.info(`[${ctx.traceId}] TOOL speak [type=${type} len=${content.length} pushed=${result.pushed} elapsed=${elapsed}ms]`);

      pushWanderStep(ctx, {
        timestamp: new Date().toISOString(),
        tool: 'speak',
        spoke: content,
        thought: `[${type}] 表达了想法`,
      });

      return result;
    },
  }),
};

/** 向后兼容别名 */
export const createSpeakTool = (ctx: ToolContext) => speakToolDef.createTool(ctx);
