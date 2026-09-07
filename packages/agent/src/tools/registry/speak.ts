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

**是否推送由你自己判断（可保持沉默）：** 与主人兴趣相关、或你自己真心觉得有意思/好奇的内容才值得推；没有值得说的就完全不调用本工具——沉默是合法且正确的选择。每次推送会消耗一条当日推送预算，判断"这条值不值得用掉配额"。主人强兴趣方向的内容相关性优先；你自己好奇图谱里的新奇话题也鼓励分享（给主人小惊喜）。最近已推送过的同主题内容（换来源也算）不要重复推。

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
      reason: z.string().optional().describe(
        '一句话说明为什么这条值得推给主人（相关性/新奇/有用），会随记录落盘展示',
      ),
    }),
    execute: async ({ content, type, reason }) => {
      ctx.stepCount++;
      const stepStart = Date.now();

      // 护栏与归因在 quality hook 的 beforeToolCall 完成（ctx.gateReasons =
      // 扫描警告，ctx.matchedTopics = 命中话题）。P3 #152：reason 是 LLM
      // 自判断的"为什么推"，与扫描警告合并落盘，仪表盘展示推送理由。
      const gateReasons = [
        ...(reason ? [reason] : []),
        ...(ctx.gateReasons ?? []),
      ];
      const result = await speak(content, type, {
        mood: ctx.state.mood,
        ...(gateReasons.length > 0 ? { gateReasons } : {}),
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
