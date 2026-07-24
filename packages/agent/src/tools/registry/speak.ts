import { tool } from 'ai';
import { z } from 'zod';
import { consola } from '../../logger.js';
import { config } from '../../config.js';
import { speak } from '../push/speak.js';
import { pushWanderStep, type ToolContext } from './context.js';
import { addVisitedUrl, extractUrl } from '../dedup/url-tracker.js';
import { getPushGate, type SpeakType as GateSpeakType } from '../../memory/push-gate.js';
import type { ToolDefinition } from '../tool-manager.js';

const logger = consola.withTag('tool:speak');

const SPEAK_DESCRIPTION = `分享内容或者碎碎念，表达你的想法。

**语言要求：** 推送内容应使用 ${config.outputLanguage} 语言。即使你搜索时用了英文/中文，最终分享时应整理为指定语言。

**内容类型：**
- share：分享链接/资源，建议包含 URL 和简要说明
- nonsense：无厘头碎碎念，可以是短句或感叹
- article：正经文章/评论，可以是长篇分析或观点表达`;

/** 发言工具定义 */
export const speakToolDef: ToolDefinition = {
  metadata: {
    name: 'speak',
    description: SPEAK_DESCRIPTION,
    category: 'content',
  },
  createTool: (ctx: ToolContext) => tool({
    description: SPEAK_DESCRIPTION,
    inputSchema: z.object({
      content: z.string().describe('你要说的话、分享的内容或者碎碎念'),
      type: z.enum(['share', 'nonsense', 'article']).describe(
        'share=分享链接/资源, nonsense=无厘头碎碎念, article=正经文章/评论',
      ),
    }),
    execute: async ({ content, type }) => {
      ctx.stepCount++;
      const stepStart = Date.now();

      // Phase 5: 推送价值门控
      let gated = false;
      let gateScore: number | undefined;
      let gateReasons: string[] | undefined;

      const gate = getPushGate(config.pushGate);

      try {
        const gateResult = await gate.evaluate(content, type as GateSpeakType);

        if (!gateResult.passed) {
          gated = true;
          gateScore = gateResult.score;
          gateReasons = gateResult.reasons;

          logger.info(`[${ctx.traceId}] TOOL speak 被门控拦截 [type=${type} score=${gateResult.score.toFixed(2)} threshold=${gateResult.threshold.toFixed(2)}]`);

          // 门控拦截时也记录 URL 去重（避免 LLM 反复尝试推同一链接）
          const url = extractUrl(content);
          if (url) {
            await addVisitedUrl(url, content).catch(err => {
              logger.error('记录门控 URL 失败', { url, error: err });
            });
          }

          pushWanderStep(ctx, {
            timestamp: new Date().toISOString(),
            tool: 'speak',
            spoke: content,
            thought: `[${type}] 内容被门控拦截 (score=${gateResult.score.toFixed(2)})`,
          });

          return {
            success: true,
            pushed: false,
            gated: true,
            gateScore: gateResult.score,
            gateReasons: gateResult.reasons,
            timestamp: new Date().toISOString(),
          };
        }

        gateScore = gateResult.score;
        gateReasons = gateResult.reasons;
      } catch (error) {
        // 门控失败不阻断 speak——默认放行
        logger.warn(`[${ctx.traceId}] PushGate 评估失败，默认放行`, { error });
      }

      const result = await speak(content, type);
      const elapsed = Date.now() - stepStart;
      ctx.spokeTimes++;

      // 附加门控信息到结果
      if (gateScore !== undefined) {
        result.gateScore = gateScore;
        result.gateReasons = gateReasons;
      }

      logger.info(`[${ctx.traceId}] TOOL speak [type=${type} len=${content.length} pushed=${result.pushed} gateScore=${gateScore?.toFixed(2) ?? 'N/A'} elapsed=${elapsed}ms]`);

      // 推送成功后记录 URL 到去重系统
      if (result.pushed) {
        const url = extractUrl(content);
        if (url) {
          await addVisitedUrl(url, content).catch(err => {
            logger.error('记录推送 URL 失败', { url, error: err });
          });
        }

        // Phase 5: 推送后触发阈值校准（异步，best-effort）
        gate.calibrate().catch(err => {
          logger.warn('阈值校准失败', { err });
        });
      }

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
