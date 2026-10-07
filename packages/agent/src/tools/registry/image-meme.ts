/**
 * image_meme 工具（#96）—— 宠物自主生成表情包
 *
 * 工具契约：LLM 判断"话题适合做表情包"时调用，传入话题。工具内部：LLM 出文案 → 画面生图 → 程序
 * 叠加文字 → 质检 → 收录（过质检才进图鉴）。生图/视觉/LLM 全部可 mock
 * （真实依赖走 meme/factory.ts，测试直接注入 fake 走 runMemePipeline）。
 *
 * 只用当前租户已交付的宠物 manifest 角色参考图；无定制形象则显式跳过。
 *
 * 推送补发：工具返回收录结果；speak 等推送方可在同一次互动里附表情包链接
 * （web 推送附链接；飞书/TG 附件见通道能力）。本工具只负责生成+收录。
 */

import { tool } from 'ai';
import { z } from 'zod';
import { getMemeImageUrl } from '@cyber-stray/shared/push';
import { consola } from '../../logger.js';
import { getConfig, getDataPath } from '../../config.js';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { pushWanderStep, type ToolContext } from './context.js';
import type { ToolDefinition } from '../tool-manager.js';
import { createMemePipelineDeps } from '../../meme/factory.js';
import { createMemeCopyRunner } from '../../meme/copy-runner.js';
import { runMemePipeline } from '../../meme/pipeline.js';
import { preparePetMemeReference } from '../../meme/reference.js';
import type { MemeCopyGenerator } from '../../meme/pipeline.js';
import type { MemePipelineDeps } from '../../meme/types.js';
import { recordMemeForPush } from '../../meme/push.js';

const logger = consola.withTag('tool:image_meme');

const IMAGE_MEME_DESCRIPTION = `用你当前已交付的宠物形象作为参考图生成一张表情包，配一句有梗的中文文案，质检通过后收录进图鉴。

**使用时机：**
- 发现了一个适合做成表情包的话题（有趣的、有情绪的、主人会会心一笑的）
- 想给有趣内容配图时先调用本工具，再把返回的 id 作为 speak 的 memeId
- 想给今天的日记/游荡配一张梗图

**注意：** 只画当前租户的宠物，不生成通用角色或 SVG 宠物。没有已交付形象时不要调用；每日配额默认 3 张，质检不合格不会进图鉴。`;

/** 工具执行上下文：真实依赖 + 文案 runner（可注入 fake 测试） */
export interface ImageMemeToolDeps {
  /** 组装管线依赖（缺省用真实 factory；测试注入） */
  buildDeps?: (dataDir: string) => MemePipelineDeps;
  /** 组装文案 runner（缺省用真实 model；测试注入 fake） */
  buildCopy?: (ctx: ToolContext) => MemeCopyGenerator;
}

/** 模块级可覆盖依赖（测试注入 fake；生产用真实实现） */
let toolDeps: ImageMemeToolDeps = {};

/** 测试注入 fake 依赖（生产不调用） */
export function setImageMemeToolDeps(deps: ImageMemeToolDeps): void {
  toolDeps = deps;
}

/** 创建文案 runner（真实：getConfig + createDeepSeek） */
function realBuildCopy(ctx: ToolContext): MemeCopyGenerator {
  const cfg = getConfig();
  const apiKey =
    cfg.plan?.plan === 'byok'
      ? cfg.secrets?.deepseekApiKey
      : (cfg.secrets?.deepseekApiKey ?? process.env.DEEPSEEK_API_KEY);
  if (!apiKey) {
    throw new Error('缺少 DeepSeek API key（环境变量 DEEPSEEK_API_KEY）');
  }
  const provider = createDeepSeek({ apiKey });
  return createMemeCopyRunner({
    petName: '我',
    personalityName: cfg.personality,
    model: provider.chat(cfg.llmModel),
  });
}

/** 表情包工具定义 */
export const imageMemeToolDef: ToolDefinition = {
  metadata: {
    name: 'image_meme',
    description: IMAGE_MEME_DESCRIPTION,
    category: 'content',
  },
  createTool: (ctx: ToolContext) => {
    const deps = toolDeps;
    return tool({
      description: IMAGE_MEME_DESCRIPTION,
      inputSchema: z.object({
        topic: z.string().min(1).max(60).describe('表情包话题（触发来源，如兴趣/日记主题）'),
      }),
      execute: async ({ topic }, options) => {
        ctx.stepCount++;
        const stepStart = Date.now();
        const dataDir = getDataPath('');
        const reference = await preparePetMemeReference(dataDir, options.abortSignal);
        if (!reference) {
          return { ok: false, reason: '当前租户没有已交付的宠物形象，无法生成专属表情包' };
        }
        const buildDeps = deps.buildDeps ?? createMemePipelineDeps;
        const buildCopy = deps.buildCopy ?? realBuildCopy;
        const pipeline = buildDeps(dataDir);
        const copyGenerator = buildCopy(ctx);

        const result = await runMemePipeline(pipeline, {
          topic, mode: 'ip', referencePath: reference.path, petSpecText: reference.specText,
          abortSignal: options.abortSignal,
        }, copyGenerator);

        const elapsed = Date.now() - stepStart;
        logger.info(
          `[${ctx.traceId}] TOOL image_meme [mode=ip status=${result.status} elapsed=${elapsed}ms]`,
        );

        pushWanderStep(ctx, {
          timestamp: new Date().toISOString(),
          tool: 'image_meme',
          thought: `[${result.status}] 给话题「${topic}」生成了表情包`,
        });

        switch (result.status) {
          case 'recorded':
            await recordMemeForPush(result.meta);
            return {
              ok: true,
              id: result.meta.id,
              topic: result.meta.topic,
              emotion: result.meta.emotion,
              file: result.meta.file,
              imageUrl: getMemeImageUrl(result.meta.id),
            };
          case 'rejected':
            return {
              ok: false,
              reason: `表情包未通过质检（${result.issues.join('；') || '原因未知'}）`,
            };
          case 'skipped':
            return { ok: false, reason: result.reason };
          case 'failed':
            return { ok: false, reason: result.error };
        }
      },
    });
  },
};

/** 向后兼容别名 */
export const createImageMemeTool = (ctx: ToolContext) => imageMemeToolDef.createTool(ctx);
