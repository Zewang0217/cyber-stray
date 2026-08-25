/**
 * 表情包真实依赖组装（#96）—— 生产环境 wiring
 *
 * 从 agent 配置/环境组装 imageGen/overlay/qc，供 image-meme 工具与
 * 睡前任务调用。测试不 import 这里（直接注入 fake 走 runMemePipeline）。
 *
 * - 生图：Seedream 5.0 Lite（ARK_API_KEY；模型/尺寸 env 可配）
 * - 叠加：meme-overlay.py（python3 + PIL，服务器端中文叠加）
 * - 质检：豆包视觉语义（ARK_API_KEY）+ 结构检查
 * - 配额：MEME_DAILY_LIMIT（env，默认 3 张/天；0 = 不限）
 */

import { createImageGenerator, createVisionQc } from './ark.js';
import { createOverlay } from './overlay.js';
import { createMemeQc } from './qc.js';
import type { MemePipelineDeps } from './types.js';

/** 从配置组装真实管线依赖 */
export function createMemePipelineDeps(dataDir: string): MemePipelineDeps {
  const apiKey = process.env.ARK_API_KEY ?? '';
  const imageModel = process.env.MEME_IMAGE_MODEL ?? 'doubao-seedream-5-0-260128';
  const visionModel = process.env.MEME_VL_MODEL ?? 'doubao-1.5-vision-pro';
  const size = process.env.MEME_IMAGE_SIZE ?? '2K'; // Seedream 5.0 无 1K 档
  const dailyLimit = Number(process.env.MEME_DAILY_LIMIT ?? 3);

  return {
    dataDir,
    imageGen: createImageGenerator(apiKey, { model: imageModel, size }),
    overlay: createOverlay(),
    qc: createMemeQc({ vision: createVisionQc(apiKey, { model: visionModel }) }),
    dailyLimit: Number.isFinite(dailyLimit) && dailyLimit >= 0 ? dailyLimit : 3,
  };
}
