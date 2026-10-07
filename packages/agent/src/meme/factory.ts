/**
 * 表情包真实依赖组装（#96）—— 生产环境 wiring
 *
 * 从 agent 配置/环境组装 imageGen/overlay/qc，供 image-meme 工具与
 * 睡前任务调用。测试不 import 这里（直接注入 fake 走 runMemePipeline）。
 *
 * - 生图：与 CP petgen 共用 ARK/CP_ARK_IMAGE_MODEL
 * - 叠加：meme-overlay.py（python3 + PIL，服务器端中文叠加）
 * - 质检：与 CP petgen 共用 CP_VISION_* 模型、端点和思考配置 + 结构检查
 * - 配额：MEME_DAILY_LIMIT（env，默认 3 张/天；0 = 不限）
 */

import { createImageGenerator } from './ark.js';
import { createVisionQc } from './vision.js';
import { createOverlay } from './overlay.js';
import { createMemeQc } from './qc.js';
import { withImageUsageTracking, withVisionUsageTracking } from '../usage/usage.js';
import type { MemePipelineDeps } from './types.js';
import { resolveVisionBaseUrl } from '@cyber-stray/shared/vision-config';

/** 与 CP 当前产线视觉配置保持一致；旧 MEME_* 仅供单机显式覆盖。 */
export function resolveMemeModelConfig(env: NodeJS.ProcessEnv = process.env) {
  const imageModel = env.CP_ARK_IMAGE_MODEL ?? env.MEME_IMAGE_MODEL ?? 'doubao-seedream-5-0-260128';
  const visionModel = env.CP_VISION_MODEL ?? env.MEME_VL_MODEL ?? 'ecnu-plus';
  return {
    imageModel,
    visionModel,
    visionBaseUrl: env.CP_VISION_BASE_URL ?? resolveVisionBaseUrl(visionModel),
    visionThinking: env.CP_VISION_THINKING !== 'false',
  };
}

/** 从配置组装真实管线依赖 */
export function createMemePipelineDeps(dataDir: string): MemePipelineDeps {
  const arkKey = process.env.ARK_API_KEY ?? '';
  const models = resolveMemeModelConfig();
  const visionKey = process.env.CP_VISION_API_KEY ?? process.env.ZHIPU_API_KEY ?? '';
  const size = process.env.MEME_IMAGE_SIZE ?? '2K'; // Seedream 5.0 无 1K 档
  const dailyLimit = Number(process.env.MEME_DAILY_LIMIT ?? 3);
  if (!arkKey) throw new Error('缺少火山方舟 API key（环境变量 ARK_API_KEY）');
  if (!visionKey) throw new Error('缺少视觉质检 API key（环境变量 CP_VISION_API_KEY / ZHIPU_API_KEY）');
  if (!Number.isFinite(dailyLimit) || dailyLimit < 0) throw new Error('MEME_DAILY_LIMIT 必须是非负数字');

  return {
    dataDir,
    // HTTP 付费响应后立即记账，解析/落盘失败也保留费用；记账失败锁住后续调用。
    imageGen: withImageUsageTracking(
      createImageGenerator(arkKey, { model: models.imageModel, size }),
      dataDir,
      models.imageModel,
    ),
    overlay: createOverlay(),
    qc: createMemeQc({
      vision: withVisionUsageTracking(createVisionQc(visionKey, {
        model: models.visionModel,
        baseUrl: models.visionBaseUrl,
        thinking: models.visionThinking,
        temperature: 0,
      }), dataDir, models.visionModel),
    }),
    dailyLimit,
  };
}
